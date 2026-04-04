import { Hono } from "hono";
import { some } from "hono/combine";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { logger as loggerMiddleware } from "hono/logger";

import { auth } from "@turbostarter/auth/server";
import { logger } from "@turbostarter/shared/logger";
import { matchesPattern } from "@turbostarter/shared/utils";

import { localize, delay } from "./middleware";
import { adminRouter } from "./modules/admin/router";
import { aiRouter } from "./modules/ai/router";
import { authRouter } from "./modules/auth/router";
import { billingRouter } from "./modules/billing/router";
import { organizationRouter } from "./modules/organization/router";
import { storageRouter } from "./modules/storage/router";
import { onError } from "./utils/on-error";

import type { Context } from "hono";

const appRouter = new Hono()
  .basePath("/api")
  .use(
    some(
      (c: Context) => !!c.req.header("x-client-platform")?.startsWith("mobile"),
      csrf({
        origin: (origin, c) =>
          [...auth.options.trustedOrigins, new URL(c.req.url).origin].some(
            (trustedOrigin) => matchesPattern(origin, trustedOrigin),
          ),
      }),
    ),
  )
  .use(
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 3600,
      credentials: true,
    }),
  )
  .use(loggerMiddleware((...args) => logger.info(...args)))
  .use(delay)
  .use(localize)
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/admin", adminRouter)
  .route("/ai", aiRouter)
  .route("/auth", authRouter)
  .route("/billing", billingRouter)
  .route("/organizations", organizationRouter)
  .route("/storage", storageRouter)
  .onError(onError);

type AppRouter = typeof appRouter;

export type { AppRouter };
export { appRouter };
