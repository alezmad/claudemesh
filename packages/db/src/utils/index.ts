import { asc, desc } from "drizzle-orm";

import * as schema from "../schema";

import type { SortPayload } from "@turbostarter/shared/schema";
import type { PgTableWithColumns, TableConfig } from "drizzle-orm/pg-core";

// Re-export drizzle-zod utilities (separate file to avoid circular deps)
export {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "./drizzle-zod";

export const getOrderByFromSort = <Schema extends TableConfig>({
  sort,
  defaultSchema,
}: {
  sort: SortPayload[];
  defaultSchema: PgTableWithColumns<Schema>;
}) => {
  return sort.map((s) => {
    const order = s.desc ? desc : asc;
    const parts = s.id.split(/[_.]/);

    const table =
      parts[0] && parts[0] in schema
        ? schema[parts[0] as keyof typeof schema]
        : defaultSchema;
    return order(table[(parts[1] ?? parts[0]) as keyof typeof table]);
  });
};
