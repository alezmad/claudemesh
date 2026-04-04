import { useEffect, useRef, useState } from "react";

export const useAudio = (url?: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
    } else if (url) {
      audioRef.current.src = url;
    }
  }, [url]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handleTimeUpdate = () => {
      const currentProgress =
        (audioElement.currentTime / audioElement.duration) * 100;
      setProgress(currentProgress);
    };

    const handleEnded = () => {
      setPlaying(false);
      setProgress(0);
    };

    audioElement.addEventListener("timeupdate", handleTimeUpdate);
    audioElement.addEventListener("ended", handleEnded);

    return () => {
      audioElement.removeEventListener("timeupdate", handleTimeUpdate);
      audioElement.removeEventListener("ended", handleEnded);
    };
  }, []);

  const play = () => {
    if (audioRef.current) {
      void audioRef.current.play();
      setPlaying(true);
    }
  };

  const pause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
  };

  const scroll = (seconds: number) => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const newTime = Math.max(
      0,
      Math.min(audioElement.duration, audioElement.currentTime + seconds),
    );
    audioElement.currentTime = newTime;
  };

  return { play, pause, playing, progress, scroll };
};
