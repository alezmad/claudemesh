"use client";

import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

import { useTts } from "../use-tts";

import { VoiceAvatar } from "./avatar";
import { VoiceVisualizer } from "./voice-visualizer";

import type { UIVoice } from "~/modules/tts/utils/types";

interface SpeechProps {
  voice: UIVoice;
}

export const Speech = ({ voice }: SpeechProps) => {
  const { status, reset, pause, play } = useTts();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-5 py-12 md:py-14 @lg:gap-6">
      <VoiceAvatar
        voice={voice}
        playing={status === "playing"}
        loading={status === "loading"}
      />

      <h1 className="mt-8 mb-2 px-6 text-center text-3xl font-bold @lg:mt-12 @lg:text-4xl">
        {voice.name}
      </h1>
      <VoiceVisualizer
        playing={status === "playing"}
        loading={status === "loading"}
      />

      <div className="mt-16 flex items-center justify-center gap-2 @lg:gap-4">
        <Button
          variant="outline"
          className="size-16 @lg:size-20"
          disabled={status === "loading"}
          onClick={status === "playing" ? pause : play}
        >
          {status === "playing" ? (
            <Icons.Pause className="size-6 @lg:size-8" />
          ) : (
            <Icons.Play className="size-6 @lg:size-8" />
          )}
        </Button>

        <Button
          variant="destructive"
          className="size-16 @lg:size-20"
          onClick={reset}
        >
          <Icons.X className="size-6 @lg:size-8" />
        </Button>
      </div>
    </div>
  );
};
