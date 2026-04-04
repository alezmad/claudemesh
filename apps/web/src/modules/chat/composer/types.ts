// Voice Recording Types

export type VoiceRecordingState = "idle" | "recording" | "processing";

export interface VoiceRecordingData {
  state: VoiceRecordingState;
  duration: number; // seconds elapsed
  audioLevel: number; // 0-100 volume level
  error: Error | null;
}

export interface UseVoiceRecordingOptions {
  onTranscription?: (text: string) => void;
  onError?: (error: Error) => void;
  onStateChange?: (state: VoiceRecordingState) => void;
}

export interface UseVoiceRecordingReturn {
  state: VoiceRecordingState;
  duration: number;
  audioLevel: number;
  error: Error | null;
  isRecording: boolean;
  isProcessing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  toggleRecording: () => void;
}

export interface VoiceButtonProps {
  state: VoiceRecordingState;
  duration: number;
  audioLevel: number;
  disabled?: boolean;
  onToggle: () => void;
  onCancel: () => void;
}
