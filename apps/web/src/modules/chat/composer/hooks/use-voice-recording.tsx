"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "~/lib/api/client";

import type {
  UseVoiceRecordingOptions,
  UseVoiceRecordingReturn,
  VoiceRecordingState,
} from "../types";

export const useVoiceRecording = (
  options: UseVoiceRecordingOptions = {}
): UseVoiceRecordingReturn => {
  const { onTranscription, onError, onStateChange } = options;

  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Update state and notify
  const updateState = useCallback(
    (newState: VoiceRecordingState) => {
      setState(newState);
      onStateChange?.(newState);
    },
    [onStateChange]
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setDuration(0);
    setAudioLevel(0);
  }, []);

  // Monitor audio levels
  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume (0-100)
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedLevel = Math.min(100, Math.round((average / 255) * 100 * 2));
    setAudioLevel(normalizedLevel);

    animationFrameRef.current = requestAnimationFrame(monitorAudioLevel);
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      cleanup();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Setup audio analysis
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start audio level monitoring
      monitorAudioLevel();

      // Setup media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop level monitoring
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        console.log("[Voice] Recording stopped, chunks:", chunksRef.current.length);

        if (chunksRef.current.length === 0) {
          console.log("[Voice] No chunks recorded, aborting");
          cleanup();
          updateState("idle");
          return;
        }

        updateState("processing");

        try {
          const audioBlob = new Blob(chunksRef.current, {
            type: mediaRecorder.mimeType,
          });

          console.log("[Voice] Audio blob:", audioBlob.size, "bytes,", mediaRecorder.mimeType);

          const formData = new FormData();
          formData.append(
            "audio",
            audioBlob,
            `recording.${mediaRecorder.mimeType.includes("webm") ? "webm" : "mp4"}`
          );

          const url = api.ai.stt.$url().toString();
          console.log("[Voice] Sending to:", url);

          const response = await fetch(url, {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          console.log("[Voice] Response status:", response.status);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("[Voice] Error response:", errorData);
            throw new Error(
              (errorData as { message?: string }).message ??
                "Transcription failed"
            );
          }

          const result = (await response.json()) as { text: string };
          console.log("[Voice] Transcription result:", result.text);
          onTranscription?.(result.text);
        } catch (err) {
          console.error("[Voice] Error:", err);
          const transcriptionError =
            err instanceof Error ? err : new Error("Transcription failed");
          setError(transcriptionError);
          onError?.(transcriptionError);
        } finally {
          cleanup();
          updateState("idle");
        }
      };

      mediaRecorder.start();
      updateState("recording");

      // Start duration timer
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const accessError =
        err instanceof Error
          ? err
          : new Error("Failed to access microphone");
      setError(accessError);
      onError?.(accessError);
      cleanup();
      updateState("idle");
    }
  }, [cleanup, monitorAudioLevel, onTranscription, onError, updateState]);

  // Stop recording (will trigger transcription)
  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Cancel recording (no transcription)
  const cancelRecording = useCallback(() => {
    cleanup();
    updateState("idle");
  }, [cleanup, updateState]);

  // Toggle recording
  const toggleRecording = useCallback(() => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle") {
      void startRecording();
    }
  }, [state, startRecording, stopRecording]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state === "recording") {
        e.preventDefault();
        cancelRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state, cancelRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    duration,
    audioLevel,
    error,
    isRecording: state === "recording",
    isProcessing: state === "processing",
    startRecording,
    stopRecording,
    cancelRecording,
    toggleRecording,
  };
};
