"use client";

import { motion } from "motion/react";
import { memo } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@turbostarter/ui-web/avatar";
import { Badge } from "@turbostarter/ui-web/badge";
import { Button } from "@turbostarter/ui-web/button";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@turbostarter/ui-web/card";
import { FormControl, FormField, FormItem } from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import { Label } from "@turbostarter/ui-web/label";
import { RadioGroup, RadioGroupItem } from "@turbostarter/ui-web/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { useAudio } from "./hooks/use-audio";

import type { UIVoice } from "../utils/types";
import type { FieldValues, Path } from "react-hook-form";
import type { Control } from "react-hook-form";

const Voice = ({ voice, selected }: { voice: UIVoice; selected: boolean }) => {
  const { t } = useTranslation("common");
  const { play, pause, playing, progress, scroll } = useAudio(voice.previewUrl);

  return (
    <Card
      key={voice.id}
      className={cn(
        "dark:bg-background flex h-full flex-col overflow-hidden rounded-2xl transition-all",
        selected ? "border-primary" : "hover:border-input border",
      )}
    >
      <Label
        htmlFor={voice.id}
        className="flex grow cursor-pointer flex-col gap-0"
      >
        <CardHeader className="flex w-full flex-row items-center justify-between gap-3.5 px-5 pt-4 pb-3">
          <Avatar className="size-10">
            <AvatarFallback>{voice.name.charAt(0)}</AvatarFallback>
            <AvatarImage src={voice.avatar?.src} style={voice.avatar?.style} />
          </Avatar>

          <div className="mr-auto min-w-0">
            <CardTitle className="truncate text-lg leading-tight">
              {voice.name}
            </CardTitle>
            <CardDescription className="truncate leading-tight capitalize">
              {voice.category}
            </CardDescription>
          </div>

          <RadioGroupItem
            value={voice.id}
            id={voice.id}
            className="mt-0.5 self-start"
          />
        </CardHeader>
        <CardContent className="flex w-full grow flex-col justify-between gap-3 pb-4">
          <div className="-ml-0.5 flex w-full flex-wrap gap-1.5">
            {voice.details.map((detail) => (
              <Badge
                variant="secondary"
                key={detail}
                className="font-normal lowercase"
              >
                {detail.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Icons.TextSearch className="size-3.5" />
              <span>
                {new Date(voice.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Icons.UsersRound className="size-3.5" />
                <span>
                  {new Intl.NumberFormat("en", {
                    notation: "compact",
                    compactDisplay: "short",
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }).format(voice.usage.cloned)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Icons.AudioWaveform className="size-3.5" />

                {new Intl.NumberFormat("en", {
                  notation: "compact",
                  compactDisplay: "short",
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }).format(voice.usage.character)}
              </div>
            </div>
          </div>
        </CardContent>
      </Label>

      <CardFooter className="bg-muted/50 relative flex justify-center overflow-hidden border-t px-3 py-1">
        <div
          className="bg-muted absolute top-0 left-0 h-full w-full transition-all duration-300 ease-linear"
          style={{
            transform: `scaleX(${progress / 100})`,
            transformOrigin: "left",
          }}
        />
        <div className="relative z-10 flex justify-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-8 rounded-full"
                  onClick={() => scroll(-5)}
                >
                  <Icons.Undo className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                -{t("second", { count: 5 })}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-8 rounded-full"
                  onClick={() => {
                    if (playing) {
                      pause();
                    } else {
                      play();
                    }
                  }}
                >
                  {playing ? (
                    <Icons.Pause className="size-3.5" />
                  ) : (
                    <Icons.Play className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {playing ? t("pause") : t("play")}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-8 rounded-full"
                  onClick={() => scroll(5)}
                >
                  <Icons.Redo className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                +{t("second", { count: 5 })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardFooter>
    </Card>
  );
};

interface VoiceSelectorProps<T extends FieldValues> {
  readonly control: Control<T>;
  readonly name: Path<T>;
  readonly options: UIVoice[];
}

type VoiceSelectorComponent = <T extends FieldValues>(
  props: VoiceSelectorProps<T>,
) => React.ReactNode;

export const VoiceSelector: VoiceSelectorComponent = memo(
  ({ control, name, options }) => {
    return (
      <FormField
        control={control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <RadioGroup
                className="grid w-full min-w-0 grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-4 pb-6"
                onValueChange={field.onChange}
                value={field.value}
              >
                {options.map((voice, index) => (
                  <motion.div
                    key={voice.id}
                    initial={{ opacity: 0, filter: "blur(4px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.2, delay: index * 0.1 }}
                  >
                    <Voice
                      key={voice.id}
                      voice={voice}
                      selected={field.value === voice.id}
                    />
                  </motion.div>
                ))}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />
    );
  },
);
