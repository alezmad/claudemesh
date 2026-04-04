import { memo } from "react";

import { getMessageTextContent } from "@turbostarter/ai";

import { ThreadMessage } from "~/modules/common/ai/thread/message";
import { Prose } from "~/modules/common/prose";

import type { ThreadMessageProps } from "~/modules/common/ai/thread/message";

export const UserMessage = memo<ThreadMessageProps>(({ message, ref }) => {
  return (
    <ThreadMessage.Layout className="items-end" ref={ref}>
      <Prose className="bg-muted min-h-7 max-w-full rounded-3xl rounded-br-lg border px-4 py-2.5 sm:max-w-[90%]">
        {getMessageTextContent(message)}
      </Prose>
    </ThreadMessage.Layout>
  );
});

UserMessage.displayName = "UserMessage";
