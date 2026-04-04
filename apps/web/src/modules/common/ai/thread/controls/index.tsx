import { cn } from "@turbostarter/ui";

import { ThreadMessageCopy } from "./copy";
import { ThreadMessageLikes } from "./likes";

import type { UIMessage } from "@ai-sdk/react";

interface ControlsProps {
  message: UIMessage;
}

export const Controls = ({ message }: ControlsProps) => {
  return (
    <div
      className={cn(
        "bg-background start-0 -ml-4 flex w-max items-center gap-px rounded-lg px-2 pb-2 text-xs opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:start-3",
      )}
    >
      {message.parts.some(
        (part) => part.type === "text" && part.text.length > 0,
      ) && <ThreadMessageCopy message={message} />}
      <ThreadMessageLikes />
    </div>
  );
};
