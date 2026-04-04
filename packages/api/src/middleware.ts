import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { env } from "hono/adapter";
import { createMiddleware } from "hono/factory";

import { getAllRolesAtOrAbove, hasAdminPermission } from "@turbostarter/auth";
import { MemberRole } from "@turbostarter/auth";
import { auth } from "@turbostarter/auth/server";
import { creditTransaction, customer } from "@turbostarter/db/schema";
import { db } from "@turbostarter/db/server";
import { makeZodI18nMap } from "@turbostarter/i18n";
import {
  getLocaleFromRequest,
  getTranslation,
} from "@turbostarter/i18n/server";
import { HttpStatusCode, NodeEnv } from "@turbostarter/shared/constants";
import { generateId, HttpException } from "@turbostarter/shared/utils";

import type { User } from "@turbostarter/auth";
import type { TFunction } from "@turbostarter/i18n";
import type { Context, ValidationTargets } from "hono";
import type { $ZodRawIssue, $ZodType } from "zod/v4/core";

type PermissionsInput = NonNullable<
  NonNullable<
    Parameters<typeof auth.api.hasPermission>[0]
  >["body"]["permissions"]
>;

/**
 * Reusable middleware that enforces users are logged in before running the
 * procedure
 */
export const enforceAuth = createMiddleware<{
  Variables: {
    user: User;
  };
}>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session?.user ?? null;

  if (!user) {
    throw new HttpException(HttpStatusCode.UNAUTHORIZED, {
      code: "error.unauthorized",
    });
  }

  c.set("user", user);
  await next();
});

/**
 * Reusable middleware that enforces that the authenticated user
 * has global admin permissions
 */
export const enforceAdmin = createMiddleware<{
  Variables: {
    user: User;
  };
}>(async (c, next) => {
  const user = c.var.user;

  if (!hasAdminPermission(user)) {
    throw new HttpException(HttpStatusCode.FORBIDDEN, {
      code: "error.forbidden",
    });
  }

  await next();
});

/**
 * Reusable middleware that enforces that the authenticated user
 * has the specified permissions in the user scope
 */
export const enforceUserPermission = ({
  permissions,
}: {
  permissions: PermissionsInput;
}) =>
  createMiddleware<{ Variables: { user: User } }>(async (c, next) => {
    const hasPermission = await auth.api.hasPermission({
      body: {
        permissions,
      },
      headers: c.req.raw.headers,
    });

    if (!hasPermission.success) {
      throw new HttpException(HttpStatusCode.FORBIDDEN, {
        code: "error.forbidden",
      });
    }

    await next();
  });

/**
 * Middleware to enforce that the authenticated user has the required permissions
 * for a given organization before allowing access to the route handler.
 */
export const enforceOrganizationPermission = ({
  organizationId,
  permissions,
}: {
  organizationId?: string;
  permissions: PermissionsInput;
}) =>
  createMiddleware<{
    Variables: {
      user: User;
    };
  }>(async (c, next) => {
    const hasPermission = await auth.api.hasPermission({
      body: {
        organizationId,
        permissions,
      },
      headers: c.req.raw.headers,
    });

    if (!hasPermission.success) {
      throw new HttpException(HttpStatusCode.FORBIDDEN, {
        code: "error.forbidden",
      });
    }

    await next();
  });

/**
 * Middleware to enforce that the authenticated user is at least a member
 * of the given organization before allowing access to the route handler.
 */
export const enforceMembership = ({
  organizationId,
  role = MemberRole.MEMBER,
}: {
  organizationId: string;
  role?: MemberRole;
}) =>
  createMiddleware<{
    Variables: {
      user: User;
    };
  }>(async (c, next) => {
    const user = c.var.user;
    try {
      const { members } = await auth.api.listMembers({
        query: {
          organizationId,
          filterField: "userId",
          filterValue: user.id,
          filterOperator: "eq",
        },
        headers: c.req.raw.headers,
      });

      const member = members.find((member) => member.userId === user.id);

      if (!member || !getAllRolesAtOrAbove(role).includes(member.role)) {
        throw new HttpException(HttpStatusCode.FORBIDDEN, {
          code: "error.forbidden",
        });
      }
    } catch {
      throw new HttpException(HttpStatusCode.FORBIDDEN, {
        code: "error.forbidden",
      });
    }

    await next();
  });

/**
 * Middleware for adding an articifial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
export const delay = createMiddleware<{
  Bindings: {
    NODE_ENV: string;
  };
}>(async (c, next) => {
  if (env(c).NODE_ENV === NodeEnv.DEVELOPMENT) {
    // artificial delay in dev 100-500ms
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  await next();
});

/**
 * Middleware for setting the language based on the cookie and accept-language header.
 */
export const localize = createMiddleware<{
  Variables: {
    locale: string;
  };
}>(async (c, next) => {
  const locale = getLocaleFromRequest(c.req.raw);
  c.set("locale", locale);
  await next();
});

/**
 * Middleware for validating the request input using Zod.
 */
export const validate = <
  T extends $ZodType,
  Target extends keyof ValidationTargets,
>(
  target: Target,
  schema: T,
) =>
  zValidator(
    target,
    schema,
    async (result, c: Context<{ Variables: { locale?: string } }, string>) => {
      if (!result.success) {
        const { t } = await getTranslation({
          locale: c.var.locale,
        });
        const error = result.error.issues[0];

        if (!error) {
          throw new HttpException(HttpStatusCode.UNPROCESSABLE_ENTITY);
        }

        const { message, code } = makeZodI18nMap({ t: t as TFunction })(
          error as $ZodRawIssue,
        );

        throw new HttpException(HttpStatusCode.UNPROCESSABLE_ENTITY, {
          code,
          message,
        });
      }
    },
  );

/**
 * Simple in-memory rate limiter middleware for AI endpoints.
 * Limits requests per user per time window.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export const rateLimiter = createMiddleware<{
  Variables: {
    user: User;
  };
}>(async (c, next) => {
  const user = c.var.user;
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 30; // 30 requests per minute

  const now = Date.now();
  const key = `rate-limit:${user.id}`;
  const record = rateLimitStore.get(key);

  if (!record || record.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    await next();
    return;
  }

  if (record.count >= maxRequests) {
    throw new HttpException(HttpStatusCode.TOO_MANY_REQUESTS, {
      code: "error.rateLimit",
      message: "Too many requests. Please try again later.",
    });
  }

  record.count += 1;
  await next();
});

/**
 * Middleware to deduct credits from a user's account before processing AI requests.
 * Takes the amount of credits to deduct and optional feature name for audit logging.
 */
export const deductCredits = (amount: number, feature?: string) =>
  createMiddleware<{
    Variables: {
      user: User;
    };
  }>(async (c, next) => {
    const user = c.var.user;

    // Find user's customer record
    const [customerRecord] = await db
      .select()
      .from(customer)
      .where(eq(customer.userId, user.id));

    if (!customerRecord) {
      throw new HttpException(HttpStatusCode.FORBIDDEN, {
        code: "error.noCredits",
        message: "No subscription found. Please subscribe to use AI features.",
      });
    }

    if (customerRecord.credits < amount) {
      throw new HttpException(HttpStatusCode.PAYMENT_REQUIRED, {
        code: "error.insufficientCredits",
        message: "Insufficient credits. Please add more credits to continue.",
      });
    }

    const newBalance = customerRecord.credits - amount;

    // Deduct credits and log transaction
    await db.transaction(async (tx) => {
      await tx
        .update(customer)
        .set({
          credits: sql`${customer.credits} - ${amount}`,
        })
        .where(eq(customer.id, customerRecord.id));

      await tx.insert(creditTransaction).values({
        id: generateId(),
        customerId: customerRecord.id,
        amount: -amount,
        type: "usage",
        reason: feature ?? "AI feature usage",
        balanceAfter: newBalance,
        metadata: JSON.stringify({
          endpoint: c.req.path,
          feature,
        }),
      });
    });

    await next();
  });
