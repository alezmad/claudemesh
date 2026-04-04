import { motion  } from "motion/react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@turbostarter/ui-web/avatar";

import type {Variants} from "motion/react";
import type { UIVoice } from "~/modules/tts/utils/types";

const avatarAnimationVariants: Variants = {
  playing: {
    scale: [1, 1.04, 0.97, 1.03, 0.98, 1.02, 1],
    rotate: [0, 1.8, -1.2, 2.5, -1.5, 0.8, 0],
    x: [0, 3, -2, 2, -3, 1, 0],
    y: [0, -3, 2, -4, 3, -1, 0],
    filter: [
      "brightness(1) contrast(1)",
      "brightness(1.08) contrast(1.04)",
      "brightness(0.98) contrast(0.99)",
      "brightness(1.06) contrast(1.03)",
      "brightness(0.97) contrast(0.98)",
      "brightness(1.04) contrast(1.02)",
      "brightness(1) contrast(1)",
    ],
    transition: {
      duration: 5,
      repeat: Infinity,
      ease: "easeInOut" as const,
      filter: {
        duration: 5,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  },
  loading: {
    scale: [1, 1.02, 0.99, 1.01, 1],
    filter: [
      "brightness(0.9) contrast(0.95) grayscale(1)",
      "brightness(0.95) contrast(0.97) grayscale(1)",
      "brightness(0.88) contrast(0.94) grayscale(1)",
      "brightness(0.93) contrast(0.96) grayscale(1)",
      "brightness(0.9) contrast(0.95) grayscale(1)",
    ],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut" as const,
      filter: {
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  },
  idle: {
    scale: 1,
    rotate: 0,
    x: 0,
    y: 0,
    filter: "brightness(1) contrast(1) grayscale(0)",
    transition: {
      duration: 1,
      ease: "easeOut" as const,
    },
  },
};

const imageAnimationVariants: Variants = {
  playing: {
    scale: [1, 1.03, 0.98, 1.02, 1],
    rotate: [0, -0.5, 0.3, -0.2, 0],
    filter: [
      "saturate(1.1) brightness(1) grayscale(0)",
      "saturate(1.25) brightness(1.05) grayscale(0)",
      "saturate(1.15) brightness(0.98) grayscale(0)",
      "saturate(1.2) brightness(1.03) grayscale(0)",
      "saturate(1.1) brightness(1) grayscale(0)",
    ],
    transition: {
      duration: 4,
      repeat: Infinity,
      ease: "easeInOut" as const,
      filter: {
        duration: 4,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  },
  loading: {
    scale: [1, 1.01, 0.99, 1],
    filter: [
      "saturate(0.8) brightness(0.9) grayscale(1)",
      "saturate(0.85) brightness(0.95) grayscale(1)",
      "saturate(0.8) brightness(0.88) grayscale(1)",
      "saturate(0.8) brightness(0.9) grayscale(1)",
    ],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut" as const,
      filter: {
        duration: 1.5,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  },
  idle: {
    scale: 1,
    rotate: 0,
    filter: "saturate(1.1) grayscale(0)",
    transition: {
      duration: 1,
      ease: "easeOut" as const,
    },
  },
};

interface VoiceAvatarProps {
  readonly voice: UIVoice;
  readonly playing: boolean;
  readonly loading: boolean;
}

export function VoiceAvatar({ voice, playing, loading }: VoiceAvatarProps) {
  const animationState = playing ? "playing" : loading ? "loading" : "idle";

  return (
    <div className="relative flex grow items-center justify-center">
      <motion.div
        animate={animationState}
        initial="idle"
        variants={avatarAnimationVariants}
        className="relative z-10 flex h-full max-h-[min(50vw,18rem)] items-center justify-center"
      >
        <Avatar className="relative aspect-square h-full w-auto">
          <AvatarFallback>{voice.name.charAt(0)}</AvatarFallback>
          <motion.div
            animate={animationState}
            initial="idle"
            variants={imageAnimationVariants}
            style={{ width: "100%", height: "100%" }}
          >
            <AvatarImage src={voice.avatar?.src} style={voice.avatar?.style} />
          </motion.div>
        </Avatar>

        {!loading && (
          <>
            <div className="absolute -inset-20 overflow-hidden rounded-full blur-3xl">
              <motion.div
                className="h-full w-full"
                style={{
                  ...voice.avatar?.style,
                  background: `radial-gradient(circle, hsla(210,100%,55%,0) 0%, hsla(210,100%,55%,0.4) 40%, hsla(210,100%,55%,0.6) 70%, hsla(210,100%,55%,0.2) 100%)`,
                  mixBlendMode: "soft-light",
                }}
                animate={{
                  opacity: [0.5, 0.8, 0.6, 0.75, 0.5],
                  scale: [0.75, 1.15, 0.95, 1.1, 0.75],
                }}
                transition={{
                  duration: 6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>

            <div className="absolute -inset-12 overflow-hidden rounded-full blur-xl">
              <motion.div
                className="h-full w-full"
                style={{
                  ...voice.avatar?.style,
                  background: `radial-gradient(circle, transparent 10%, hsla(210,100%,55%)/0.5) 60%, hsla(210,100%,55%)/0.7) 80%, transparent 100%)`,
                }}
                animate={{
                  opacity: [0.6, 0.9, 0.7, 0.85, 0.6],
                  scale: [0.75, 1.05, 0.95, 1.02, 0.75],
                }}
                transition={{
                  duration: 4.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.5,
                }}
              />
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
