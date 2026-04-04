import { memo } from "react";

import { ChatComposer } from "~/modules/chat/composer";
import { ChatDropzone } from "~/modules/chat/composer/dropzone";
import { useComposer } from "~/modules/chat/composer/hooks/use-composer";
import { Examples } from "~/modules/chat/layout/examples";
import { Headline } from "~/modules/chat/layout/headline";

interface NewChatProps {
  id: string;
}

export const NewChat = memo<NewChatProps>(({ id }) => {
  const { model } = useComposer({ id });
  return (
    <ChatDropzone disabled={!model?.attachments}>
      <div className="mx-auto flex h-full w-full flex-col items-center justify-between gap-6 md:justify-center md:gap-9 md:p-2">
        <div className="flex w-full grow items-end">
          <Headline />
        </div>
        <div className="flex w-full grow flex-col items-center justify-between md:flex-col-reverse md:justify-end md:gap-5">
          <Examples className="flex" id={id} />
          <div className="relative w-full px-3 pb-3">
            <ChatComposer id={id} />
          </div>
        </div>
      </div>
    </ChatDropzone>
  );
});

NewChat.displayName = "NewChat";
