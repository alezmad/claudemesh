"use client";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import type { VoiceButtonProps } from "../types";

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const VoiceLevelBars = ({ level }: { level: number }) => {
  // Create 3 bars with different thresholds
  const bars = [
    { threshold: 10, delay: "0ms" },
    { threshold: 30, delay: "100ms" },
    { threshold: 50, delay: "200ms" },
  ];

  return (
    <div className="flex items-end gap-0.5 h-3">
      {bars.map((bar, i) => (
        <div
          key={i}
          className={cn(
            "w-0.5 bg-white rounded-full transition-all duration-150",
            level > bar.threshold ? "opacity-100" : "opacity-30"
          )}
          style={{
            height: level > bar.threshold ? `${Math.min(12, 4 + (level / 100) * 8)}px` : "4px",
            animationDelay: bar.delay,
          }}
        />
      ))}
    </div>
  );
};

export const VoiceButton = ({
  state,
  duration,
  audioLevel,
  disabled = false,
  onToggle,
  onCancel: _onCancel,
}: VoiceButtonProps) => {
  const { t } = useTranslation("common");

  const isRecording = state === "recording";
  const isProcessing = state === "processing";

  const getTooltipContent = () => {
    if (isRecording) {
      return t("pressEscapeToCancel");
    }
    if (isProcessing) {
      return t("transcribing");
    }
    return t("record");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative">
          {/* Recording state indicator - shows duration and level */}
          {isRecording && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              <span>{formatDuration(duration)}</span>
              <VoiceLevelBars level={audioLevel} />
            </div>
          )}

          <Button
            className={cn(
              "shrink-0 rounded-full transition-all duration-200",
              isRecording && "bg-destructive hover:bg-destructive/90 text-destructive-foreground animate-pulse-ring",
              isProcessing && "opacity-70"
            )}
            size="icon"
            type="button"
            variant={isRecording ? "destructive" : "ghost"}
            onClick={onToggle}
            disabled={disabled || isProcessing}
          >
            {isProcessing ? (
              <>
                <Icons.Loader2 className="size-4 animate-spin" />
                <span className="sr-only">{t("transcribing")}</span>
              </>
            ) : isRecording ? (
              <>
                <Icons.Square className="size-3.5 fill-current" />
                <span className="sr-only">{t("stop")}</span>
              </>
            ) : (
              <>
                <Icons.Mic className="size-4" />
                <span className="sr-only">{t("record")}</span>
              </>
            )}
          </Button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {getTooltipContent()}
      </TooltipContent>
    </Tooltip>
  );
};

export default VoiceButton;
