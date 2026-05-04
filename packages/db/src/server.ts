import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "./env";
import { schema } from "./schema";

const client = postgres(env.DATABASE_URL ?? "");
// `schema` aggregates many `import * as <ns>` namespace bags. Drizzle's
// TSchema generic struggles with namespace-typed records — the runtime
// shape is correct but tsc can't unify the deeply-nested table/relation
// types against DrizzleConfig's overload set. ts-expect-error keeps the
// rest of the typecheck honest while documenting the known mismatch.
// @ts-expect-error drizzle TSchema generic narrowing
export const db = drizzle(client, { schema, casing: "snake_case" });
