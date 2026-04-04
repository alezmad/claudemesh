"use client";

import { Role } from "@turbostarter/ai/chat/types";

import { Thread } from "../../common/ai/thread";
import { useComposer } from "../composer/hooks/use-composer";

import { AssistantMessage } from "./message/assistant";
import { UserMessage } from "./message/user";

import type { ChatMessage } from "@turbostarter/ai/chat/types";

interface ChatProps {
  readonly id?: string;
  readonly initialMessages?: ChatMessage[];
}

const components = {
  [Role.USER]: UserMessage,
  [Role.ASSISTANT]: AssistantMessage,
};

export const Chat = ({ id, initialMessages }: ChatProps = {}) => {
  const { messages, regenerate, error, status } = useComposer({
    id,
    initialMessages,
  });

  return (
    <Thread
      messages={messages}
      initialMessages={initialMessages}
      status={status}
      components={components}
      error={error}
      regenerate={regenerate}
    />
  );
};
