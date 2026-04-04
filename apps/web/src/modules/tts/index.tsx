"use client";

import { AnimatePresence, motion } from "motion/react";

import { TtsComposer } from "./composer";
import { Speech } from "./speech";
import { useTts } from "./use-tts";

import type { UIVoice } from "./utils/types";

interface TtsProps {
  readonly voices: UIVoice[];
}

export function Tts({ voices }: TtsProps) {
  const { status, input } = useTts();

  const voice = voices.find((voice) => voice.id === input?.options.voice.id);
  const showComposer = ["idle", "error"].includes(status) || !voice;

  return (
    <AnimatePresence mode="wait">
      {showComposer ? (
        <motion.div
          key="composer"
          className="h-full w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <TtsComposer voices={voices} />
        </motion.div>
      ) : (
        <motion.div
          key="speech"
          className="h-full w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Speech voice={voice} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
