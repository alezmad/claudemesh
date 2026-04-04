"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { MODELS } from "@turbostarter/ai/image/constants";
import { imageGenerationSchema } from "@turbostarter/ai/image/schema";
import { useDebounceCallback } from "@turbostarter/shared/hooks";
import { generateId } from "@turbostarter/shared/utils";

import { useImageGeneration } from "~/modules/image/use-image-generation";

import type {
  ImageGenerationOptionsPayload,
  ImageGenerationPayload,
} from "@turbostarter/ai/image/schema";
import type { WatchObserver } from "react-hook-form";

interface ImageComposerState {
  prompt: string;
  options: ImageGenerationOptionsPayload;
  setPrompt: (prompt: string) => void;
  setOptions: (options: Partial<ImageGenerationOptionsPayload>) => void;
  reset: () => void;
}

const DEFAULT_OPTIONS = {
  model: MODELS[0].id,
  aspectRatio: MODELS[0].dimensions[0].id,
  count: 1,
};

const useImageComposerStore = create<ImageComposerState>()(
  persist(
    (set) => ({
      prompt: "",
      options: DEFAULT_OPTIONS,
      setPrompt: (prompt) => set({ prompt }),
      setOptions: (options) =>
        set((state) => ({
          options: { ...state.options, ...options },
        })),
      reset: () =>
        set({
          prompt: "",
          options: DEFAULT_OPTIONS,
        }),
    }),
    {
      name: "image-options",
      partialize: (state) => ({ options: state.options }),
    },
  ),
);

interface UseComposerProps {
  id?: string;
}

export const useComposer = ({ id: passedId }: UseComposerProps = {}) => {
  const { prompt, options, setPrompt, setOptions, reset } =
    useImageComposerStore();
  const currentId = useRef(passedId);

  const { createGeneration } = useImageGeneration({
    id: currentId.current,
  });

  useEffect(() => {
    if (currentId.current !== passedId) {
      reset();
      currentId.current = passedId ?? generateId();
    }
  }, [passedId, reset]);

  const newForm = useForm({
    resolver: zodResolver(imageGenerationSchema),
    defaultValues: {
      prompt,
      options,
    },
  });
  const contextForm = useFormContext<ImageGenerationPayload>();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const form = contextForm ?? newForm;

  const model = form.watch("options.model");

  const sync: WatchObserver<ImageGenerationPayload> = useCallback(
    (values) => {
      setPrompt(values.prompt ?? "");
      setOptions(values.options ?? DEFAULT_OPTIONS);
    },
    [setOptions, setPrompt],
  );

  const debouncedSync = useDebounceCallback(sync, 500, {
    leading: true,
  });

  useEffect(() => {
    const subscription = form.watch(debouncedSync);
    return () => subscription.unsubscribe();
  }, [form, debouncedSync]);

  const onSubmit = (input: ImageGenerationPayload) => {
    form.resetField("prompt");
    createGeneration.mutate(input);
  };

  return {
    form,
    model,
    prompt,
    onSubmit,
    reset,
  };
};
