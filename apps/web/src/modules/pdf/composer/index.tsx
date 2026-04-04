"use client";

import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

import { Composer } from "~/modules/common/ai/composer";

import { useComposer } from "./use-composer";

import type { PdfMessage } from "@turbostarter/ai/pdf/types";

interface ChatComposerProps {
  readonly id?: string;
  readonly initialMessages?: PdfMessage[];
}

export const ChatComposer = ({
  id,
  initialMessages,
}: ChatComposerProps = {}) => {
  const { t } = useTranslation(["ai", "common"]);
  const { status, input, setInput, sendMessage, stop } = useComposer({
    id,
    initialMessages,
  });

  return (
    <Composer.Form
      onSubmit={(e) => {
        e.preventDefault();
        void sendMessage({
          text: input,
        });
        setInput("");
      }}
    >
      <Composer.Input className="rounded-xl @sm:rounded-2xl">
        <Composer.Textarea
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          maxLength={5_000}
          placeholder={t("pdf.composer.placeholder")}
          className="pr-11 @[480px]/input:pr-11"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();

              if (!["submitted", "streaming"].includes(status)) {
                void sendMessage({
                  text: input,
                });
                setInput("");
              }
            }
          }}
        />

        <Button
          className="absolute right-3 bottom-3 rounded-full"
          disabled={
            !input.trim() && !["submitted", "streaming"].includes(status)
          }
          size="icon"
          type="submit"
          onClick={(e) => {
            if (["submitted", "streaming"].includes(status)) {
              e.preventDefault();
              return stop();
            }
          }}
        >
          {["submitted", "streaming"].includes(status) ? (
            <Icons.Pause className="size-4" />
          ) : (
            <Icons.Send className="size-4" />
          )}
        </Button>
      </Composer.Input>
    </Composer.Form>
  );
};
