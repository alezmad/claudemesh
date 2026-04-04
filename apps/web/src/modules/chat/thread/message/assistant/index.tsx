import { memo } from "react";

import { WebSearch } from "~/modules/chat/thread/message/assistant/tools/web-search";
import { ThreadMessage } from "~/modules/common/ai/thread/message";
import { MemoizedMarkdown } from "~/modules/common/markdown/memoized-markdown";
import { Prose } from "~/modules/common/prose";

import { ReasoningMessagePart } from "./reasoning";

import type { ChatMessage } from "@turbostarter/ai/chat/types";
import type { ThreadMessageProps } from "~/modules/common/ai/thread/message";

export const AssistantMessage = memo<ThreadMessageProps<ChatMessage>>(
  ({ message, ref, status }) => {
    return (
      <ThreadMessage.Layout className="items-start" ref={ref}>
        <Prose className="w-full max-w-none">
          {message.parts.map((part, partIndex) => {
            switch (part.type) {
              case "text":
                return (
                  <MemoizedMarkdown
                    key={`${message.id}-${partIndex}`}
                    content={part.text}
                    id={`text-${partIndex}`}
                  />
                );
              case "reasoning":
                return (
                  <ReasoningMessagePart
                    key={`${message.id}-${partIndex}`}
                    part={part}
                    reasoning={
                      status === "streaming" &&
                      partIndex === message.parts.length - 1
                    }
                    defaultExpanded={status === "streaming"}
                  />
                );

              case "tool-web-search":
                switch (part.state) {
                  case "input-available":
                  case "output-available":
                    return (
                      <WebSearch
                        key={`${message.id}-${partIndex}`}
                        {...part}
                        annotations={message.parts.filter(
                          (p) => p.type === "data-query_completion",
                        )}
                      />
                    );
                }
            }
          })}
        </Prose>

        {!["submitted", "streaming"].includes(status) && (
          <ThreadMessage.Controls message={message} />
        )}
      </ThreadMessage.Layout>
    );
  },
);

AssistantMessage.displayName = "AssistantMessage";
