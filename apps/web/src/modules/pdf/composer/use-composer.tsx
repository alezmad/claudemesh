import { useChat } from "@ai-sdk/react";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

import { getMessageTextContent } from "@turbostarter/ai";
import { generateId } from "@turbostarter/shared/utils";

import { api } from "~/lib/api/client";
import { useAIError } from "~/modules/common/hooks/use-ai-error";
import { useCredits } from "~/modules/common/layout/credits";

import type { PdfMessage } from "@turbostarter/ai/pdf/types";

const chats = new Map<string, Chat<PdfMessage>>();

const getChatInstance = ({
  id,
  ...options
}: ConstructorParameters<typeof Chat<PdfMessage>>[0]) => {
  if (!id || !chats.has(id)) {
    const chat = new Chat<PdfMessage>({
      id,
      ...options,
    });

    chats.set(id ?? chat.id, chat);
  }

  const instance = chats.get(id ?? "");
  if (!instance) {
    throw new Error(`Chat instance with id ${id} not found!`);
  }
  return instance;
};

interface UseComposerProps {
  readonly id?: string;
  readonly initialMessages?: PdfMessage[];
}

export const useComposer = ({
  id: passedId,
  initialMessages,
}: UseComposerProps = {}) => {
  const [input, setInput] = useState("");

  const { onError } = useAIError();
  const { invalidate } = useCredits();
  const id = passedId ?? generateId();

  const chat = getChatInstance({
    id,
    transport: new DefaultChatTransport({
      api: api.ai.pdf.chats[":id"].messages
        .$url({
          param: {
            id,
          },
        })
        .toString(),
      prepareSendMessagesRequest: ({ messages }) => {
        const lastMessage = messages.at(-1);

        return {
          body: {
            id: lastMessage?.id,
            role: lastMessage?.role,
            content: getMessageTextContent(lastMessage),
          },
        };
      },
    }),
    messages: initialMessages,
    onFinish: () => {
      void invalidate();
    },
    onError,
  });

  const result = useChat({
    chat,
  });

  return {
    ...result,
    input,
    setInput,
  };
};
