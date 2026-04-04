import { Hono } from "hono";

import { validate } from "../../../middleware";
import { getMeshesInputSchema } from "../../../schema";

import { getMeshById, getMeshes } from "./queries";

export const meshesRouter = new Hono()
  .get("/", validate("query", getMeshesInputSchema), async (c) =>
    c.json(await getMeshes(c.req.valid("query"))),
  )
  .get("/:id", async (c) =>
    c.json(
      (await getMeshById(c.req.param("id"))) ?? {
        mesh: null,
        members: [],
        presences: [],
        invites: [],
        auditEvents: [],
      },
    ),
  );
