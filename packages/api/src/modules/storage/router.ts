import { Hono } from "hono";
import { z } from "zod";

import {
  getObjectUrlSchema,
  getUploadUrl,
  getSignedUrl,
  getPublicUrl,
  getDeleteUrl,
} from "@turbostarter/storage/server";

import { enforceAuth, validate } from "../../middleware";

const proxyFetchSchema = z.object({
  url: z.string().url(),
  validate: z.coerce.boolean().optional().default(false),
});

export const storageRouter = new Hono()
  .get(
    "/upload",
    enforceAuth,
    validate("query", getObjectUrlSchema),
    async (c) => c.json(await getUploadUrl(c.req.valid("query"))),
  )
  .get("/public", validate("query", getObjectUrlSchema), async (c) =>
    c.json(await getPublicUrl(c.req.valid("query"))),
  )
  .get(
    "/signed",
    enforceAuth,
    validate("query", getObjectUrlSchema),
    async (c) => c.json(await getSignedUrl(c.req.valid("query"))),
  )
  .get(
    "/delete",
    enforceAuth,
    validate("query", getObjectUrlSchema),
    async (c) => c.json(await getDeleteUrl(c.req.valid("query"))),
  )
  .get(
    "/proxy",
    enforceAuth,
    validate("query", proxyFetchSchema),
    async (c) => {
      const { url, validate: validateOnly } = c.req.valid("query");

      // Do a HEAD request to validate the URL
      const headResponse = await fetch(url, {
        method: "HEAD",
        headers: {
          "User-Agent": "TurboStarter/1.0",
        },
      });

      if (!headResponse.ok) {
        return c.json(
          { error: "Failed to fetch URL", status: headResponse.status },
          400,
        );
      }

      const contentType = headResponse.headers.get("content-type");
      if (!contentType?.includes("application/pdf")) {
        return c.json(
          { error: "URL does not point to a PDF file" },
          400,
        );
      }

      const contentLength = headResponse.headers.get("content-length") ?? "0";

      // If just validating, return headers only
      if (validateOnly) {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": contentLength,
          },
        });
      }

      // Fetch the actual content
      const response = await fetch(url, {
        headers: {
          "User-Agent": "TurboStarter/1.0",
        },
      });

      const blob = await response.blob();
      return new Response(blob, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": blob.size.toString(),
        },
      });
    },
  );
