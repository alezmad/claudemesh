import { Hono } from "hono";

import { validate } from "../../../middleware";
import { getSessionsInputSchema } from "../../../schema";

import { getSessions } from "./queries";

export const sessionsRouter = new Hono().get(
  "/",
  validate("query", getSessionsInputSchema),
  async (c) => c.json(await getSessions(c.req.valid("query"))),
);
