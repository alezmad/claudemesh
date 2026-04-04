import { useMutation } from "@tanstack/react-query";
import { create } from "zustand";

import { api } from "~/lib/api/client";
import { useAIError } from "~/modules/common/hooks/use-ai-error";
import { useCredits } from "~/modules/common/layout/credits";

import type { TtsPayload } from "@turbostarter/ai/tts/schema";

interface TtsState {
  status: "idle" | "loading" | "playing" | "paused" | "error";
  audio: HTMLAudioElement | null;
  input: TtsPayload | null;
  update: (state: Partial<TtsState>) => void;
}

const useTtsStore = create<TtsState>()((set) => ({
  status: "idle",
  audio: null,
  input: null,
  update: (updates) =>
    set((state) => ({
      ...state,
      ...updates,
    })),
}));

export const useTts = () => {
  const { onError } = useAIError();
  const { invalidate } = useCredits();
  const { update, status, audio, input } = useTtsStore();

  const speak = useMutation({
    mutationFn: async (json: TtsPayload) => {
      if (!MediaSource.isTypeSupported("audio/mpeg")) {
        throw new Error("Unsupported MIME type or codec: audio/mpeg");
      }

      const response: Response = await api.ai.tts.$post({
        json,
      });

      if (!response.ok) {
        throw new Error("Failed to speak!");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const audio = new Audio(
        /^(http|https|blob:|data:)/.test(url)
          ? url
          : `data:audio/wav;base64,${url}`,
      );

      audio.onended = () => {
        update({ status: "paused" });
      };

      update({ audio });
      return audio;
    },
    onMutate: (input) => {
      update({ status: "loading", input });
    },
    onSuccess: (audio) => {
      update({ status: "playing" });
      void invalidate();
      void audio.play();
    },
    onError: (e) => {
      onError(e);
      update({ status: "error" });
    },
  });

  const play = () => {
    if (audio) {
      void audio.play();
      update({ status: "playing" });
    }
  };

  const pause = () => {
    if (audio) {
      audio.pause();
      update({ status: "paused" });
    }
  };

  const reset = () => {
    update({ status: "idle", audio: null, input: null });
  };

  return {
    status,
    audio,
    input,
    speak,
    play,
    pause,
    reset,
  };
};
