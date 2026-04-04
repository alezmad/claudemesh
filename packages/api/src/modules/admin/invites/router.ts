import { Hono } from "hono";

import { validate } from "../../../middleware";
import { getInvitesInputSchema } from "../../../schema";

import { getInvites } from "./queries";

export const invitesRouter = new Hono().get(
  "/",
  validate("query", getInvitesInputSchema),
  async (c) => c.json(await getInvites(c.req.valid("query"))),
);
