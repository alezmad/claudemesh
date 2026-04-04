---
title: Schema
description: Learn about the database schema.
url: /docs/web/database/schema
---

# Schema

Creating a schema for your data is one of the primary tasks when building a new application.

You can find the schema of each table in `packages/db/src/db/schema` directory. The schema is basically organized by entity and each file is a separate table.

## Defining schema

The schema is defined using SQL-like utilities from [drizzle-orm](https://orm.drizzle.team/docs/sql-schema-declaration).

It supports all the SQL features, such as enums, indexes, foreign keys, extensions and more.

<Callout title="Code-first approach">
  We're relying on the [code-first approach](https://orm.drizzle.team/docs/migrations), where we define the schema in code and then generate the SQL from it. That way we can approach full type-safety and the simplest flow for database updates and migrations.
</Callout>

## Example

Let's take a look at the `customer` table, where we store information about our customers.

```typescript title="customer.ts"
export const customer = pgTable("customer", {
  id: text().primaryKey().$defaultFn(generateId),
  userId: text()
    .references(() => user.id, {
      onDelete: "cascade",
    })
    .notNull()
    .unique(),
  customerId: text().notNull().unique(),
  status: billingStatusEnum(),
  plan: pricingPlanTypeEnum(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .$onUpdate(() => new Date()),
});
```

We're using a few native SQL utilities here, such as:

* `pgTable` - a table definition.
* `primaryKey` - a primary key.
* `defaultFn` - a default function.
* `$onUpdate` - an on update function.
* `notNull` - a not null constraint.
* `defaultNow` - a default now function.
* `timestamp` - a timestamp.
* `text` - a text.
* `unique` - a unique constraint.
* `references` - a reference to another table.

What's more, Drizzle gives us the ability to export the TypeScript types for the table, which we can reuse e.g. for the API calls.

Also, we can use the drizzle extension [drizzle-zod](https://orm.drizzle.team/docs/zod) to generate the Zod schemas for the table.

```typescript title="customer.ts"
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const insertCustomerSchema = createInsertSchema(customer);
export const selectCustomerSchema = createSelectSchema(customer);
export const updateCustomerSchema = createUpdateSchema(customer);

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type SelectCustomer = z.infer<typeof selectCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
```

Then we can use the generated schemas in our API handlers and frontend forms to validate the data.
