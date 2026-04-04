import { Hono } from "hono";
import * as z from "zod";

import { Credits } from "@turbostarter/ai/credits/utils";
import {
  createGeneration,
  generateImages,
  getGeneration,
  getGenerationImages,
  getImages,
} from "@turbostarter/ai/image/api";
import { imageGenerationSchema } from "@turbostarter/ai/image/schema";

import { deductCredits, enforceAuth, rateLimiter, validate } from "../../middleware";
import { withTimeout } from "../../utils";

import type { User } from "@turbostarter/auth";

const generationsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .post(
    "/",
    enforceAuth,
    validate("json", imageGenerationSchema),
    async (c) => {
      const input = c.req.valid("json");
      const creditsAmount = input.options.count * Credits.COST.DEFAULT;

      // Deduct credits
      await deductCredits(creditsAmount, "image-generation")(c, async () => { /* noop */ });

      return c.json(
        await createGeneration({
          userId: c.var.user.id,
          ...input,
          ...input.options,
        }),
      );
    },
  )
  .post("/:id/images", enforceAuth, rateLimiter, async (c) =>
    c.json(
      await withTimeout(
        generateImages({
          id: c.req.param("id"),
          abortSignal: c.req.raw.signal,
        }),
        55 * 1000,
      ),
    ),
  )
  .get("/:id", enforceAuth, async (c) =>
    c.json((await getGeneration(c.req.param("id"))) ?? null),
  )
  .get("/:id/images", enforceAuth, async (c) =>
    c.json(await getGenerationImages(c.req.param("id"))),
  );

const imagesRouter = new Hono<{
  Variables: {
    user: User;
  };
}>().get(
  "/",
  enforceAuth,
  validate(
    "query",
    z
      .object({
        limit: z.number().optional(),
        cursor: z.coerce.date().optional(),
      })
      .optional(),
  ),
  async (c) =>
    c.json(
      await getImages({
        userId: c.var.user.id,
        ...c.req.valid("query"),
      }),
    ),
);

export const imageRouter = new Hono()
  .route("/generations", generationsRouter)
  .route("/images", imagesRouter);
