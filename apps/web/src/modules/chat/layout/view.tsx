"use client";

import { memo } from "react";

import { ChatComposer } from "~/modules/chat/composer";
import { ChatDropzone } from "~/modules/chat/composer/dropzone";
import { Chat } from "~/modules/chat/thread";

import { useComposer } from "../composer/hooks/use-composer";

import type { ChatMessage } from "@turbostarter/ai/chat/types";

interface ViewChatProps {
  readonly id: string;
  readonly initialMessages?: ChatMessage[];
}

export const ViewChat = memo<ViewChatProps>(({ id, initialMessages }) => {
  const { model } = useComposer({ id, initialMessages });

  return (
    <ChatDropzone disabled={!model?.attachments}>
      <Chat id={id} initialMessages={initialMessages} />

      <div className="absolute inset-x-0 bottom-0 z-50 mx-auto max-w-[50rem]">
        <div className="relative z-40 flex w-full flex-col items-center px-3 pb-3">
          <ChatComposer id={id} initialMessages={initialMessages} />
        </div>
      </div>
    </ChatDropzone>
  );
});

ViewChat.displayName = "ViewChat";
