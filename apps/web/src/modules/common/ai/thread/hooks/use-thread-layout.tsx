import { useEffect, useRef, useState } from "react";

import { Role } from "@turbostarter/ai/chat/types";

import type { UIMessage } from "@ai-sdk/react";

interface UseThreadLayoutProps<MESSAGE extends UIMessage> {
  readonly messages: MESSAGE[];
  readonly initialMessages?: MESSAGE[];
}

export const useThreadLayout = <MESSAGE extends UIMessage>({
  messages,
  initialMessages,
}: UseThreadLayoutProps<MESSAGE>) => {
  const [scrolledByUser, setScrolledByUser] = useState(false);

  const lastMessage = messages.at(-1);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const isChatActive = initialMessages?.length !== messages.length;

  const lastUserMessageIndex = [...messages]
    .reverse()
    .findIndex((m) => m.role === Role.USER);
  const lastResponseMessages = messages.slice(
    lastUserMessageIndex !== 0 ? -2 : -1,
  );
  const previousMessages = messages.slice(0, -lastResponseMessages.length);

  useEffect(() => {
    if (!lastMessageRef.current) return;

    const parent = lastMessageRef.current.parentElement;
    let timeoutId: NodeJS.Timeout;

    const handleScroll = () => {
      setScrolledByUser(true);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setScrolledByUser(false);
      }, 1000);
    };

    parent?.addEventListener("scroll", handleScroll);

    return () => {
      parent?.removeEventListener("scroll", handleScroll);
      clearTimeout(timeoutId);
    };
  }, [lastMessageRef]);

  useEffect(() => {
    if (!lastMessageRef.current) return;

    const parent = lastMessageRef.current.parentElement;

    const isAtBottom = () => {
      const container = parent?.closest("[data-radix-scroll-area-viewport]");

      if (!container) return false;

      const scrollBottom = container.scrollTop + container.clientHeight;
      return Math.abs(container.scrollHeight - scrollBottom) < 150;
    };

    if (isChatActive) {
      if (lastMessage?.role === Role.USER) {
        requestAnimationFrame(() => {
          parent?.scrollIntoView({
            behavior: "smooth",
            block: "end",
          });
        });
      } else if (isAtBottom() && !scrolledByUser) {
        requestAnimationFrame(() => {
          parent?.scrollIntoView({
            behavior: "instant",
            block: "end",
          });
        });
      }
      return;
    }

    const animationFrameId = requestAnimationFrame(() => {
      parent?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });

    return () => cancelAnimationFrame(animationFrameId);
  }, [lastMessage, scrolledByUser, isChatActive]);

  return {
    lastMessage,
    lastMessageRef,
    isChatActive,
    lastResponseMessages,
    previousMessages,
  };
};
