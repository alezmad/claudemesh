"use client";

import { useCallback, useEffect, useRef } from "react";

import { Role } from "@turbostarter/ai/chat/types";
import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import { ScrollArea } from "@turbostarter/ui-web/scroll-area";

import { AnalyzingImage } from "./analyzing-image";
import { useThreadLayout } from "./hooks/use-thread-layout";
import { ThreadMessage } from "./message";

import type { ThreadMessageComponents } from "./message";
import type { UIMessage } from "@ai-sdk/react";

interface ThreadProps<MESSAGE extends UIMessage> {
  readonly messages: MESSAGE[];
  readonly initialMessages?: MESSAGE[];
  readonly status: string;
  readonly error?: Error | null;
  readonly regenerate?: () => Promise<void>;
  readonly className?: string;
  readonly components: ThreadMessageComponents<MESSAGE>;
  readonly footer?: React.ReactNode;
}

export const Thread = <MESSAGE extends UIMessage>({
  messages,
  initialMessages,
  status,
  error,
  regenerate,
  className,
  components,
  footer,
}: ThreadProps<MESSAGE>) => {
  const { t } = useTranslation("common");
  const isReloading = useRef(false);

  const {
    lastMessage,
    lastMessageRef,
    isChatActive,
    previousMessages,
    lastResponseMessages,
  } = useThreadLayout({ messages, initialMessages });

  useEffect(() => {
    if (
      messages.at(-1)?.role === Role.USER &&
      status === "ready" &&
      !isReloading.current
    ) {
      isReloading.current = true;
      void regenerate?.().finally(() => {
        isReloading.current = false;
      });
    }
  }, [regenerate, messages, status]);

  const renderMessage = useCallback(
    (message: MESSAGE) => {
      return (
        <ThreadMessage.Message
          message={message}
          key={message.id}
          status={status}
          components={components}
          {...(message.id === lastMessage?.id && { ref: lastMessageRef })}
        />
      );
    },
    [lastMessage?.id, lastMessageRef, status, components],
  );

  return (
    <ScrollArea
      className={cn(
        "@container/thread h-full w-full pt-12 pb-4 md:pt-14",
        className,
      )}
    >
      <div className="px-5">
        {previousMessages.map(renderMessage)}
        <div
          className={cn("mx-auto flex w-full max-w-3xl flex-col", {
            "min-h-[calc(100vh-4rem)] md:min-h-[calc(100vh-5.5rem)]":
              isChatActive,
          })}
        >
          {lastResponseMessages.map(renderMessage)}
          {["submitted", "streaming"].includes(status) && (
            <div className="relative py-4 md:px-4">
              {status === "submitted" &&
              messages.at(-1)?.role === Role.USER &&
              messages
                .at(-1)
                ?.parts.some(
                  (part) =>
                    part.type === "file" && part.mediaType.startsWith("image"),
                ) ? (
                <AnalyzingImage />
              ) : (
                <Icons.Loader className="text-muted-foreground size-5 animate-spin" />
              )}
            </div>
          )}
          {footer}
          {error && (
            <div className="relative pb-4 @lg/thread:px-2 @xl/thread:px-4">
              <div className="bg-destructive/10 dark:bg-destructive/40 flex w-fit flex-wrap items-center gap-3 rounded-xl p-5 py-3">
                <p className="text-destructive dark:text-foreground">
                  {t("error.general")}
                </p>
                <Button
                  variant="destructive"
                  className="h-auto gap-2"
                  onClick={() => regenerate?.()}
                >
                  <Icons.RotateCw className="size-4" />
                  {t("reload")}
                </Button>
              </div>
            </div>
          )}
          <div className="w-full pb-[calc(var(--composer-height)+20px)]"></div>
        </div>
      </div>
    </ScrollArea>
  );
};
