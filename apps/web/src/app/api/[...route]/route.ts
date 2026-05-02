import { handle } from "hono/vercel";

import { appRouter } from "@turbostarter/api";

// Streamable endpoints (e.g. /v1/topics/:name/stream SSE) need to keep
// the connection open for minutes, not the 10s default. 300s is the
// Vercel Pro ceiling; on Hobby the platform clamps to 60s and the
// client auto-reconnects via the SSE retry loop.
export const maxDuration = 300;

// Force dynamic rendering — streaming responses can't be statically
// optimized and we don't want Next caching SSE traffic.
export const dynamic = "force-dynamic";

const handler = handle(appRouter);
export {
  handler as GET,
  handler as POST,
  handler as OPTIONS,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
};
