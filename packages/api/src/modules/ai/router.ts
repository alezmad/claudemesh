import { Hono } from "hono";

import { getUserCredits } from "@turbostarter/ai/credits/server";

import { enforceAuth } from "../../middleware";

import { chatRouter } from "./chat";
import { imageRouter } from "./image";
import { pdfRouter } from "./pdf";
import { sttRouter } from "./stt";
import { ttsRouter } from "./tts";

export const aiRouter = new Hono()
  .use(enforceAuth)
  .route("/chat", chatRouter)
  .route("/pdf", pdfRouter)
  .route("/image", imageRouter)
  .route("/tts", ttsRouter)
  .route("/stt", sttRouter)
  .get("/credits", async (c) => c.json(await getUserCredits(c.var.user.id)));
