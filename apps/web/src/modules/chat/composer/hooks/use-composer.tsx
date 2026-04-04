"use client";

import { useChat } from "@ai-sdk/react";
import { Chat } from "@ai-sdk/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useState } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { MODELS } from "@turbostarter/ai/chat/constants";
import { chatMessageOptionsSchema } from "@turbostarter/ai/chat/schema";
import { useDebounceCallback } from "@turbostarter/shared/hooks";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/client";
import { authClient } from "~/lib/auth/client";
import { chat as chatApi } from "~/modules/chat/lib/api";
import { useAIError } from "~/modules/common/hooks/use-ai-error";
import { useCredits } from "~/modules/common/layout/credits";

import { useAttachments } from "./use-attachments";

import type { ChatMessageOptionsPayload } from "@turbostarter/ai/chat/schema";
import type { ChatMessage } from "@turbostarter/ai/chat/types";
import type { WatchObserver } from "react-hook-form";

interface ChatOptionsState {
  options: ChatMessageOptionsPayload;
  setOptions: (options: Partial<ChatMessageOptionsPayload>) => void;
}

export const useChatOptions = create<ChatOptionsState>()(
  persist(
    (set) => ({
      options: {
        reason: false,
        search: false,
        model: MODELS[0].id,
      },
      setOptions: (options) =>
        set((state) => ({
          options: {
            ...state.options,
            ...options,
          },
        })),
    }),
    {
      name: "chat-options",
    },
  ),
);

const chats = new Map<string, Chat<ChatMessage>>();

const getChatInstance = ({
  id,
  ...options
}: ConstructorParameters<typeof Chat<ChatMessage>>[0]) => {
  if (!id || !chats.has(id)) {
    const chat = new Chat<ChatMessage>({
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
  readonly initialMessages?: ChatMessage[];
}

export const useComposer = ({ id, initialMessages }: UseComposerProps = {}) => {
  const [input, setInput] = useState("");

  const { onError } = useAIError();
  const { invalidate } = useCredits();
  const { data } = authClient.useSession();
  const queryClient = useQueryClient();

  const { options, setOptions } = useChatOptions();
  const { attachments, upload, onClear } = useAttachments();
  const newForm = useForm({
    resolver: zodResolver(chatMessageOptionsSchema),
    defaultValues: options,
  });

  const contextForm = useFormContext<ChatMessageOptionsPayload>();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const form = contextForm ?? newForm;

  const chat = getChatInstance({
    id,
    transport: new DefaultChatTransport({
      api: api.ai.chat.chats.$url().toString(),
      prepareSendMessagesRequest: ({ messages, id }) => {
        const lastMessage = messages.at(-1);

        const directory = `attachments/${id}/${lastMessage?.id}`;

        upload.mutate({
          directory,
        });

        return {
          body: {
            ...lastMessage,
            chatId: id,
            parts: lastMessage?.parts.map((part) =>
              part.type === "file"
                ? {
                    ...part,
                    path: `${directory}/${part.filename}.${part.mediaType.split("/")[1] ?? "png"}`,
                  }
                : part,
            ),
          },
        };
      },
    }),
    messages: initialMessages,
    onFinish: () => {
      void invalidate();
      if (!initialMessages?.length) {
        void queryClient.invalidateQueries(
          chatApi.queries.chats.user.getAll(data?.user.id ?? ""),
        );
      }
    },
    onError,
  });

  const { messages, sendMessage, ...rest } = useChat({
    chat,
  });

  const syncOptions: WatchObserver<ChatMessageOptionsPayload> = useCallback(
    (values) => setOptions(values),
    [setOptions],
  );

  const debouncedSyncOptions = useDebounceCallback(syncOptions, 500);

  useEffect(() => {
    const subscription = form.watch(debouncedSyncOptions);
    return () => subscription.unsubscribe();
  }, [form, debouncedSyncOptions]);

  const onSubmit = useCallback(
    (prompt?: string) => {
      const url = pathsConfig.apps.chat.chat(chat.id);

      window.history.replaceState({}, "", url);

      if (prompt) {
        return sendMessage({
          text: prompt,
          metadata: {
            options: chatMessageOptionsSchema.parse(form.getValues()),
          },
        });
      } else {
        const dataTransfer = new DataTransfer();
        attachments.forEach((attachment) => {
          dataTransfer.items.add(attachment);
        });

        void sendMessage({
          text: input,
          files: dataTransfer.files,
          metadata: {
            options: chatMessageOptionsSchema.parse(form.getValues()),
          },
        });
        setInput("");
      }
    },
    [sendMessage, input, attachments, chat.id, form],
  );

  const model = MODELS.find((model) => model.id === form.watch("model"));

  useEffect(() => {
    if (!model?.attachments) {
      onClear();
    }
  }, [model?.attachments, onClear]);

  return {
    messages,
    form,
    onSubmit,
    input,
    setInput,
    model,
    ...rest,
  };
};
