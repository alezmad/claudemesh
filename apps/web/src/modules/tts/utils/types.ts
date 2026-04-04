import type { Voice } from "@turbostarter/ai/tts/types";

export type UIVoice = Voice & {
  avatar?: {
    src: string;
    style?: React.CSSProperties;
  };
};
