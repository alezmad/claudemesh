import { unstable_cache } from "next/cache";

import { getVoices } from "@turbostarter/ai/tts/api";

// Skip static generation - requires ELEVENLABS_API_KEY at runtime
export const dynamic = "force-dynamic";
import { random } from "@turbostarter/shared/utils";

import { Tts } from "~/modules/tts";

const getCachedVoices = unstable_cache(
  async () => {
    const voices = await getVoices();

    return voices.map((voice) => ({
      ...voice,
      avatar: {
        src: `/images/avatars/${random(1, 3)}.webp`,
        style: {
          filter: `hue-rotate(${random(0, 360)}deg) saturate(1.2)`,
          transform: `rotate(${random(0, 360)}deg)`,
        },
      },
    }));
  },
  ["voices"],
  {
    revalidate: 3600 * 24, // Cache for 1 day
    tags: ["voices"],
  },
);

export default async function TtsPage() {
  const voices = await getCachedVoices();

  return <Tts voices={voices} />;
}
