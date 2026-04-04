"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { MODELS } from "@turbostarter/ai/tts/constants";
import { ttsSchema } from "@turbostarter/ai/tts/schema";
import { useDebounceCallback } from "@turbostarter/shared/hooks";

import { useTts } from "~/modules/tts/use-tts";

import type {
  TtsOptionsPayload,
  TtsPayload,
} from "@turbostarter/ai/tts/schema";
import type { Voice } from "@turbostarter/ai/tts/types";
import type { WatchObserver } from "react-hook-form";

interface TtsComposerState {
  text: string;
  options: TtsOptionsPayload;
  setText: (text: string) => void;
  setOptions: (options: Partial<TtsOptionsPayload>) => void;
  reset: () => void;
}

const DEFAULT_OPTIONS = {
  model: MODELS[0].id,
  voice: {
    id: "",
    speed: 1,
    stability: 0.5,
    similarity: 0.75,
    boost: false,
  },
};

const useTtsComposerStore = create<TtsComposerState>()(
  persist(
    (set) => ({
      text: "",
      options: DEFAULT_OPTIONS,
      setText: (text) => set({ text }),
      setOptions: (options) =>
        set((state) => ({
          options: { ...state.options, ...options },
        })),
      reset: () =>
        set({
          text: "",
          options: DEFAULT_OPTIONS,
        }),
    }),
    {
      name: "tts-options",
      partialize: (state) => ({ options: state.options }),
    },
  ),
);

interface UseComposerProps {
  voices: Voice[];
}

export const useComposer = ({ voices }: UseComposerProps) => {
  const { speak } = useTts();
  const { options, reset, setOptions, setText } = useTtsComposerStore();

  const newForm = useForm({
    resolver: zodResolver(ttsSchema),
    defaultValues: {
      text: "",
      options,
    },
  });
  const contextForm = useFormContext<TtsPayload>();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const form = contextForm ?? newForm;

  useEffect(() => {
    if (voices.length && !options.voice.id) {
      const newOptions = {
        ...options,
        voice: {
          ...options.voice,
          id: voices[0]?.id ?? "",
        },
      };
      setOptions(newOptions);
      form.setValue("options", newOptions);
    }
  }, [voices, options, setOptions, form]);

  const sync: WatchObserver<TtsPayload> = useCallback(
    (values) => {
      setText(values.text ?? "");
      setOptions({
        ...(values.options ?? DEFAULT_OPTIONS),
        voice: {
          ...(values.options?.voice ?? DEFAULT_OPTIONS.voice),
          id: values.options?.voice?.id ?? "",
        },
      });
    },
    [setText, setOptions],
  );

  const debouncedSync = useDebounceCallback(sync, 500);

  useEffect(() => {
    const subscription = form.watch(debouncedSync);
    return () => subscription.unsubscribe();
  }, [form, debouncedSync]);

  const onSubmit = (input: TtsPayload) => {
    form.resetField("text");
    speak.mutate(input);
  };

  const resetVoiceSettings = () => {
    form.setValue("options.voice", {
      ...DEFAULT_OPTIONS.voice,
      id: options.voice.id,
    });
  };

  return {
    form,
    setText,
    onSubmit,
    reset,
    resetVoiceSettings,
  };
};
