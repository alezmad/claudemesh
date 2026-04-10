import { Hono } from "hono";

import type { User } from "@turbostarter/auth";

import { enforceAuth, validate } from "../../middleware";
import {
  createEmailInviteInputSchema,
  createMyInviteInputSchema,
  createMyMeshInputSchema,
  getMyMeshesInputSchema,
} from "../../schema";

import {
  archiveMyMesh,
  createEmailInvite,
  createMyInvite,
  createMyMesh,
  leaveMyMesh,
} from "./mutations";
import {
  getMyExport,
  getMyInvitesSent,
  getMyMeshById,
  getMyMeshStream,
  getMyMeshes,
} from "./queries";

type Env = { Variables: { user: User } };

export const myRouter = new Hono<Env>()
  .use(enforceAuth)
  .get("/meshes", validate("query", getMyMeshesInputSchema), async (c) => {
    const user = c.var.user;
    return c.json(
      await getMyMeshes({ userId: user.id, ...c.req.valid("query") }),
    );
  })
  .post("/meshes", validate("json", createMyMeshInputSchema), async (c) => {
    const user = c.var.user;
    try {
      const result = await createMyMesh({
        userId: user.id,
        input: c.req.valid("json"),
      });
      return c.json(result);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Failed to create mesh." },
        400,
      );
    }
  })
  .get("/meshes/:id/stream", async (c) => {
    const user = c.var.user;
    return c.json(
      (await getMyMeshStream({
        userId: user.id,
        meshId: c.req.param("id"),
      })) ?? { presences: [], envelopes: [], auditEvents: [] },
    );
  })
  .get("/meshes/:id", async (c) => {
    const user = c.var.user;
    return c.json(
      (await getMyMeshById({
        userId: user.id,
        meshId: c.req.param("id"),
      })) ?? { mesh: null, members: [], invites: [] },
    );
  })
  .post(
    "/meshes/:id/invites",
    validate("json", createMyInviteInputSchema),
    async (c) => {
      const user = c.var.user;
      try {
        const result = await createMyInvite({
          userId: user.id,
          meshId: c.req.param("id"),
          input: c.req.valid("json"),
        });
        return c.json(result);
      } catch (e) {
        return c.json(
          {
            error:
              e instanceof Error ? e.message : "Failed to create invite.",
          },
          400,
        );
      }
    },
  )
  .post(
    "/meshes/:id/invites/email",
    validate("json", createEmailInviteInputSchema),
    async (c) => {
      const user = c.var.user;
      try {
        const result = await createEmailInvite({
          userId: user.id,
          meshId: c.req.param("id"),
          input: c.req.valid("json"),
        });
        return c.json(result);
      } catch (e) {
        return c.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "Failed to send email invite.",
          },
          400,
        );
      }
    },
  )
  .post("/meshes/:id/archive", async (c) => {
    const user = c.var.user;
    try {
      const result = await archiveMyMesh({
        userId: user.id,
        meshId: c.req.param("id"),
      });
      return c.json(result);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Failed to archive." },
        400,
      );
    }
  })
  .post("/meshes/:id/leave", async (c) => {
    const user = c.var.user;
    try {
      const result = await leaveMyMesh({
        userId: user.id,
        meshId: c.req.param("id"),
      });
      return c.json(result);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Failed to leave." },
        400,
      );
    }
  })
  .get("/invites", async (c) => {
    const user = c.var.user;
    return c.json({ sent: await getMyInvitesSent({ userId: user.id }) });
  })
  .get("/export", async (c) => {
    const user = c.var.user;
    const data = await getMyExport({ userId: user.id });
    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      ...data,
    });
  });
