import { Hono } from "hono";

import { validate } from "../../../middleware";
import { getAuditInputSchema } from "../../../schema";

import { getAudit } from "./queries";

export const auditRouter = new Hono().get(
  "/",
  validate("query", getAuditInputSchema),
  async (c) => c.json(await getAudit(c.req.valid("query"))),
);
