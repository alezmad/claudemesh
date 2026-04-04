import { memo, useState } from "react";

import { ThreadMessage } from "~/modules/common/ai/thread/message";
import { Thumbnail, ThumbnailImage, Viewer } from "~/modules/common/image";
import { Prose } from "~/modules/common/prose";

import type { ChatMessage } from "@turbostarter/ai/chat/types";
import type { FileUIPart } from "ai";
import type { ThreadMessageProps } from "~/modules/common/ai/thread/message";

const Attachments = ({ attachments }: { attachments: FileUIPart[] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);

  if (!attachments.length) {
    return null;
  }

  return (
    <>
      <div className="mb-1 flex max-w-full flex-row flex-wrap items-center justify-end gap-1.5">
        {attachments
          .filter((attachment) => attachment.mediaType.includes("image/"))
          .map((attachment, index) => {
            return (
              <Thumbnail
                key={attachment.url}
                index={index}
                onClick={() => {
                  setIsOpen(true);
                  setSelectedImage(index);
                }}
                className="aspect-square h-24 w-24 border bg-transparent shadow-none sm:h-32 sm:w-32 dark:bg-transparent"
              >
                <ThumbnailImage
                  src={attachment.url}
                  alt=""
                  key={attachment.url}
                />
              </Thumbnail>
            );
          })}
      </div>

      <Viewer
        open={isOpen}
        onOpenChange={setIsOpen}
        images={attachments}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
      />
    </>
  );
};

export const UserMessage = memo<ThreadMessageProps<ChatMessage>>(
  ({ message, ref }) => {
    const attachments = message.parts.filter((part) => part.type === "file");
    return (
      <ThreadMessage.Layout className="items-end" ref={ref}>
        {attachments.length > 0 && (
          <Attachments
            key={`${message.id}-attachments`}
            attachments={attachments}
          />
        )}
        {message.parts.map((part, index) => {
          switch (part.type) {
            case "text":
              return (
                <Prose
                  key={`${message.id}-${index}`}
                  className="bg-muted min-h-7 max-w-full rounded-3xl rounded-br-lg border px-4 py-2.5 sm:max-w-[90%]"
                >
                  {part.text}
                </Prose>
              );
          }
        })}
      </ThreadMessage.Layout>
    );
  },
);

UserMessage.displayName = "UserMessage";
