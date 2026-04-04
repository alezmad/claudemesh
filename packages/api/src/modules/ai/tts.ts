import { Hono } from "hono";

import { Credits } from "@turbostarter/ai/credits/utils";
import { getVoices, textToSpeech } from "@turbostarter/ai/tts/api";
import { ttsSchema } from "@turbostarter/ai/tts/schema";

import { deductCredits, enforceAuth, rateLimiter, validate } from "../../middleware";

import type { User } from "@turbostarter/auth";

export const ttsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .post(
    "/",
    enforceAuth,
    rateLimiter,
    validate("json", ttsSchema),
    async (c) => {
      const input = c.req.valid("json");

      // Deduct credits
      await deductCredits(Credits.COST.HIGH, "text-to-speech")(c, async () => { /* noop */ });

      return new Response(
        (await textToSpeech(input)) as unknown as ConstructorParameters<
          typeof Response
        >[0],
        {
          headers: { "Content-Type": "audio/mpeg" },
        },
      );
    },
  )
  .get("/voices", enforceAuth, async (c) => {
    const voices = await getVoices();
    return c.json(voices);
  });
