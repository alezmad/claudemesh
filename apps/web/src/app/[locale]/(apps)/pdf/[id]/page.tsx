import * as z from "zod";

import { messageSchema } from "@turbostarter/ai/pdf/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { ChatComposer } from "~/modules/pdf/composer";
import { Chat } from "~/modules/pdf/thread";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) => {
  const id = (await params).id;
  const chat = await handle(api.ai.pdf.chats[":id"].$get)({
    param: { id },
  });

  return getMetadata({
    ...(chat?.name && { title: chat.name }),
  })({ params });
};

const PdfChat = async ({ params }: { params: Promise<{ id: string }> }) => {
  const id = (await params).id;
  const messages = await handle(api.ai.pdf.chats[":id"].messages.$get, {
    schema: z.array(messageSchema),
  })({
    param: { id },
  });

  const initialMessages = messages.map((message) => ({
    ...message,
    parts: [
      {
        type: "text" as const,
        text: message.content,
      },
    ],
  }));

  return (
    <>
      <Chat id={id} initialMessages={initialMessages} />

      <div className="absolute inset-x-0 bottom-0 z-50 mx-auto max-w-200">
        <div className="relative z-40 flex w-full flex-col items-center px-3 pb-3">
          <ChatComposer id={id} initialMessages={initialMessages} />
        </div>
      </div>
    </>
  );
};

export default PdfChat;
