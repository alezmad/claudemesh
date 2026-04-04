import { Hono } from "hono";


import { enforceAdmin, enforceAuth, validate } from "../../../middleware";
import {
  getCustomersInputSchema,
  getTransactionsSchema,
  updateCreditsSchema,
  updateCustomerInputSchema,
} from "../../../schema";

import {
  deleteCustomer,
  updateCustomer,
  updateCustomerCredits,
} from "./mutations";
import { getCustomerTransactions, getCustomers } from "./queries";

import type { Session, User } from "@turbostarter/auth";

interface Variables {
  user: User;
  session: Session;
}

export const customersRouter = new Hono<{ Variables: Variables }>()
  .get("/", validate("query", getCustomersInputSchema), async (c) =>
    c.json(await getCustomers(c.req.valid("query"))),
  )
  .patch("/:id", validate("json", updateCustomerInputSchema), async (c) =>
    c.json(
      await updateCustomer({
        id: c.req.param("id"),
        data: c.req.valid("json"),
      }),
    ),
  )
  .delete("/:id", async (c) =>
    c.json(await deleteCustomer({ id: c.req.param("id") })),
  )
  // Credit management endpoints
  .patch(
    "/:id/credits",
    enforceAuth,
    enforceAdmin,
    validate("json", updateCreditsSchema),
    async (c) => {
      const customerId = c.req.param("id");
      const input = c.req.valid("json");
      const admin = c.var.user;

      const result = await updateCustomerCredits(customerId, input, admin.id);

      return c.json(result);
    },
  )
  .get(
    "/:id/transactions",
    enforceAuth,
    enforceAdmin,
    validate("query", getTransactionsSchema.omit({ customerId: true })),
    async (c) => {
      const customerId = c.req.param("id");
      const query = c.req.valid("query");

      const result = await getCustomerTransactions({
        ...query,
        customerId,
      });

      return c.json(result);
    },
  );
