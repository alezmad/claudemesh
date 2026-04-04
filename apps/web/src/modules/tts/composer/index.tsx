"use client";

import { memo } from "react";

import { MODELS } from "@turbostarter/ai/tts/constants";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import { ScrollArea } from "@turbostarter/ui-web/scroll-area";

import { Composer } from "~/modules/common/ai/composer";
import { ModelSelector } from "~/modules/common/ai/composer/model-selector";

import { useComposer } from "./hooks/use-composer";
import { Settings } from "./settings";
import { VoiceSelector } from "./voice-selector";

import type { UIVoice } from "~/modules/tts/utils/types";

interface TtsComposerProps {
  voices: UIVoice[];
}

export const TtsComposer = memo<TtsComposerProps>(({ voices }) => {
  const { t } = useTranslation(["common", "ai"]);
  const { onSubmit, form, resetVoiceSettings } = useComposer({ voices });

  return (
    <div className="h-full w-full overflow-hidden pt-12 md:pt-14">
      <Form {...form}>
        <Composer.Form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex h-full w-full flex-col"
        >
          <ScrollArea className="h-full min-h-0 w-full px-5">
            <VoiceSelector
              control={form.control}
              name="options.voice.id"
              options={voices}
            />
          </ScrollArea>
          <div className="relative z-20 mx-auto w-full px-3 pb-3 shadow-[0_-72px_52px_-16px_var(--background)]">
            <Composer.Input className="mx-auto pb-12">
              <FormField
                control={form.control}
                name="text"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Composer.Textarea
                        {...field}
                        placeholder={t("tts.composer.placeholder")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();

                            return form.handleSubmit(onSubmit)();
                          }
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="absolute inset-x-0 bottom-0 flex w-full gap-1.5 overflow-hidden border-2 border-transparent p-2 @[480px]/input:p-3">
                <Settings
                  control={form.control}
                  path="options.voice"
                  onReset={resetVoiceSettings}
                />

                <div className="ml-auto flex w-full items-center justify-end gap-1.5">
                  <ModelSelector
                    control={form.control}
                    name="options.model"
                    options={MODELS}
                  />

                  <Button
                    className="shrink-0 rounded-full"
                    disabled={!form.formState.isValid}
                    size="icon"
                    type="submit"
                  >
                    <Icons.AudioLines className="size-5" />
                  </Button>
                </div>
              </div>
            </Composer.Input>
          </div>
        </Composer.Form>
      </Form>
    </div>
  );
});

TtsComposer.displayName = "TtsComposer";
