import { Hono } from "hono";

import type { User } from "@turbostarter/auth";

import { enforceAuth, validate } from "../../middleware";
import {
  createMyInviteInputSchema,
  createMyMeshInputSchema,
  getMyMeshesInputSchema,
} from "../../schema";

import {
  archiveMyMesh,
  createMyInvite,
  createMyMesh,
  leaveMyMesh,
} from "./mutations";
import {
  getMyInvitesSent,
  getMyMeshById,
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
  });
