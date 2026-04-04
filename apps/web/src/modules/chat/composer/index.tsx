"use client";

import { toast } from "sonner";

import { MODELS } from "@turbostarter/ai/chat/constants";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import { Toggle } from "@turbostarter/ui-web/toggle";

import { Composer } from "~/modules/common/ai/composer";
import { ModelSelector } from "~/modules/common/ai/composer/model-selector";

import { VoiceButton } from "./components/voice-button";
import { useAttachments } from "./hooks/use-attachments";
import { useComposer } from "./hooks/use-composer";
import { useVoiceRecording } from "./hooks/use-voice-recording";

import type { ChatMessage } from "@turbostarter/ai/chat/types";

interface ChatComposerProps {
  readonly id?: string;
  readonly initialMessages?: ChatMessage[];
}

export const ChatComposer = ({
  id,
  initialMessages,
}: ChatComposerProps = {}) => {
  const { t } = useTranslation(["ai", "common"]);
  const { status, stop, form, onSubmit, model, input, setInput } = useComposer({
    id,
    initialMessages,
  });

  const { attachments, onRemove, onPaste } = useAttachments();

  const {
    state: voiceState,
    duration,
    audioLevel,
    toggleRecording,
    cancelRecording,
  } = useVoiceRecording({
    onTranscription: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    },
    onError: (error) => {
      const message = error.message.includes("microphone")
        ? t("microphoneDenied", { ns: "common" })
        : t("transcriptionFailed", { ns: "common" });
      toast.error(message);
    },
  });

  const isSubmitting = ["submitted", "streaming"].includes(status);

  return (
    <Form {...form}>
      <Composer.Form onSubmit={form.handleSubmit(() => onSubmit())}>
        <Composer.Input className="pb-12">
          <Composer.Attachments.Preview
            attachments={attachments}
            onRemove={onRemove}
          />

          <Composer.Textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            maxLength={5_000}
            placeholder={t("chat.composer.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();

                if (!isSubmitting) {
                  return form.handleSubmit(() => onSubmit())();
                }
              }
            }}
            onPaste={onPaste}
          />

          <div className="absolute inset-x-0 bottom-0 flex w-full gap-1.5 overflow-hidden border-2 border-transparent p-2 @[480px]/input:p-3">
            <Composer.Attachments.Input disabled={!model?.attachments} />

            <div className="flex max-w-full grow gap-1.5">
              <FormField
                control={form.control}
                name="search"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Toggle
                        variant="outline"
                        className="text-muted-foreground w-9 gap-1.5 rounded-full p-0 @lg:w-auto @lg:px-3.5"
                        pressed={model?.tools && !!field.value}
                        onPressedChange={field.onChange}
                        disabled={!model?.tools}
                      >
                        <Icons.Globe className="size-4 shrink-0" />
                        <span className="text-foreground hidden @lg:inline">
                          {t("search.label")}
                        </span>
                      </Toggle>
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Toggle
                        variant="outline"
                        className="text-muted-foreground w-9 gap-1.5 rounded-full p-0 @lg:w-auto @lg:px-3.5"
                        pressed={model?.reason && !!field.value}
                        onPressedChange={field.onChange}
                        disabled={!model?.reason}
                      >
                        <Icons.Sparkle className="size-4" />
                        <span className="text-foreground hidden @lg:inline">
                          {t("reason")}
                        </span>
                      </Toggle>
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <ModelSelector
              control={form.control}
              name="model"
              options={MODELS}
            />

            <VoiceButton
              state={voiceState}
              duration={duration}
              audioLevel={audioLevel}
              disabled={isSubmitting}
              onToggle={toggleRecording}
              onCancel={cancelRecording}
            />

            <Button
              className="shrink-0 rounded-full"
              disabled={!input.trim() && !isSubmitting}
              size="icon"
              type="submit"
              onClick={(e) => {
                if (isSubmitting) {
                  e.preventDefault();
                  return stop();
                }
              }}
            >
              {isSubmitting ? (
                <>
                  <Icons.Square className="size-4 fill-current" />
                  <span className="sr-only">{t("stop")}</span>
                </>
              ) : (
                <>
                  <Icons.ArrowUp className="size-5" />
                  <span className="sr-only">{t("send")}</span>
                </>
              )}
            </Button>
          </div>
        </Composer.Input>
      </Composer.Form>
    </Form>
  );
};
