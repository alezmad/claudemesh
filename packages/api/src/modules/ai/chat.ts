import { Hono } from "hono";

import {
  getUserChats,
  deleteChat,
  getChat,
  streamChat,
  getChatMessagesWithAttachments,
} from "@turbostarter/ai/chat/api";
import { chatMessageSchema } from "@turbostarter/ai/chat/schema";
import { getCreditsDeduction } from "@turbostarter/ai/chat/utils";

import { deductCredits, enforceAuth, rateLimiter, validate } from "../../middleware";

import type { User } from "@turbostarter/auth";

const chatsRouter = new Hono<{
  Variables: {
    user: User;
  };
}>()
  .post(
    "/",
    enforceAuth,
    rateLimiter,
    validate("json", chatMessageSchema),
    async (c) => {
      const input = c.req.valid("json");
      const creditsAmount = getCreditsDeduction(input.metadata.options, input.parts);

      // Deduct credits
      await deductCredits(creditsAmount, "chat")(c, async () => { /* noop */ });

      return streamChat({
        ...input,
        signal: c.req.raw.signal,
        userId: c.var.user.id,
      });
    },
  )
  .get("/", enforceAuth, async (c) => c.json(await getUserChats(c.var.user.id)))
  .delete("/:id", enforceAuth, async (c) => c.json(await deleteChat(c.req.param("id"))))
  .get("/:id", enforceAuth, async (c) => c.json((await getChat(c.req.param("id"))) ?? null))
  .get("/:id/messages", enforceAuth, async (c) =>
    c.json(await getChatMessagesWithAttachments(c.req.param("id"))),
  );

export const chatRouter = new Hono().route("/chats", chatsRouter);
