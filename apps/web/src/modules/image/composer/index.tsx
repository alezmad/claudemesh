"use client";

import { useEffect } from "react";

import { MODELS } from "@turbostarter/ai/image/constants";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";

import { Composer } from "~/modules/common/ai/composer";
import { ModelSelector } from "~/modules/common/ai/composer/model-selector";

import { AspectSelector } from "./aspect-selector";
import { ImageCountSelector } from "./image-count-selector";
import { useComposer } from "./use-composer";

interface ImageComposerProps {
  id?: string;
  prompt?: string;
  reset?: () => void;
}

export const ImageComposer = ({
  id,
  prompt: initialPrompt,
  reset,
}: ImageComposerProps) => {
  const { t } = useTranslation(["ai", "common"]);
  const { form, model, onSubmit } = useComposer({ id });

  const prompt = form.watch("prompt");

  useEffect(() => {
    if (initialPrompt) {
      form.setValue("prompt", initialPrompt);
      form.setFocus("prompt");
      reset?.();
    }
  }, [initialPrompt, form, reset]);

  return (
    <Form {...form}>
      <Composer.Form onSubmit={form.handleSubmit(onSubmit)}>
        <Composer.Input className="pb-12">
          <FormField
            control={form.control}
            name="prompt"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Composer.Textarea
                    {...field}
                    autoFocus
                    maxLength={5_000}
                    placeholder={t("image.composer.placeholder")}
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
            <div className="flex max-w-full grow gap-px">
              <ImageCountSelector control={form.control} name="options.count" />
              <AspectSelector
                control={form.control}
                name="options.aspectRatio"
                options={MODELS.find((m) => m.id === model)?.dimensions ?? []}
              />
            </div>

            <ModelSelector
              control={form.control}
              name="options.model"
              options={MODELS}
            />

            <Button
              className="ml-auto shrink-0 rounded-full"
              disabled={!prompt.trim()}
              size="icon"
              type="submit"
            >
              <Icons.ImagePlay className="size-5" />
            </Button>
          </div>
        </Composer.Input>
      </Composer.Form>
    </Form>
  );
};
