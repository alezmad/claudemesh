"use client";

import { useState, useEffect } from "react";

import { cn } from "@turbostarter/ui";

interface VoiceVisualizerProps {
  readonly playing: boolean;
  readonly loading: boolean;
  readonly bars?: number;
}

export function VoiceVisualizer({
  playing,
  loading,
  bars = 40,
}: VoiceVisualizerProps) {
  const [time, setTime] = useState(0);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (playing) {
      intervalId = setInterval(() => {
        setTime((t) => t + 1);
      }, 1000);
    } else {
      setTime(0);
    }

    return () => clearInterval(intervalId);
  }, [playing, time]);

  return (
    <div className="flex h-16 w-4/5 max-w-[45rem] shrink-0 items-center justify-center gap-0.5 @md:h-20 @md:gap-1 @lg:h-24 @lg:gap-1.5">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "grow rounded-full transition-all [transition-duration:200ms]",
            playing ? "bg-foreground/65" : "bg-muted h-4/5",
            {
              "animate-pulse": playing || loading,
            },
          )}
          style={{
            ...(isClient ? { animationDelay: `${i * 0.05}s` } : {}),
            ...(playing || loading
              ? { height: `${20 + Math.random() * 80}%` }
              : {}),
          }}
        />
      ))}
    </div>
  );
}
