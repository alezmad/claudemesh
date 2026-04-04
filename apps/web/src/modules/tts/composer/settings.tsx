"use client";

import { useTranslation } from "@turbostarter/i18n";
import { useBreakpoint } from "@turbostarter/ui-web";
import { Button } from "@turbostarter/ui-web/button";
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@turbostarter/ui-web/drawer";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@turbostarter/ui-web/popover";
import { Slider } from "@turbostarter/ui-web/slider";
import { Switch } from "@turbostarter/ui-web/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import type { Control, FieldValues, Path } from "react-hook-form";

const SettingLabel = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <FormLabel className="decoration-border hover:decoration-foreground w-fit cursor-pointer underline decoration-dashed underline-offset-2 transition-colors">
          {title}
        </FormLabel>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-sm">
        {description}
      </TooltipContent>
    </Tooltip>
  );
};

interface SettingsProps<T extends FieldValues> {
  control: Control<T>;
  path: Path<T>;
  onReset: () => void;
}

export const Settings = <T extends FieldValues>({
  control,
  path,
  onReset,
}: SettingsProps<T>) => {
  const { t } = useTranslation(["common", "ai"]);
  const isDesktop = useBreakpoint("md");

  const renderTrigger = () => (
    <Button
      variant="outline"
      size="icon"
      className="text-muted-foreground shrink-0 rounded-full"
    >
      <Icons.Settings className="size-4" />
      <span className="sr-only">{t("settings")}</span>
    </Button>
  );

  const renderContent = () => (
    <div className="grid gap-5">
      <FormField
        control={control}
        name={`${path}.speed` as Path<T>}
        render={({ field }) => (
          <FormItem className="gap-1.5">
            <SettingLabel
              title={t("speed")}
              description={t("tts.composer.settings.voice.speed.description")}
            />
            <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
              <span>{t("slower")}</span>
              <span>{t("faster")}</span>
            </div>
            <FormControl>
              <div className="flex items-center gap-3">
                <Slider
                  id="speed"
                  min={0.7}
                  max={1.2}
                  step={0.01}
                  value={[field.value]}
                  onValueChange={(vals) => {
                    field.onChange(vals[0]);
                  }}
                  className="flex-1"
                />
                <span className="text-muted-foreground w-12 text-right text-sm tabular-nums">
                  {/* eslint-disable-next-line i18next/no-literal-string */}
                  {Number(field.value).toFixed(2)}x
                </span>
              </div>
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`${path}.stability` as Path<T>}
        render={({ field }) => (
          <FormItem className="gap-1.5">
            <SettingLabel
              title={t("stability")}
              description={t(
                "tts.composer.settings.voice.stability.description",
              )}
            />
            <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
              <span>{t("moreVariable")}</span>
              <span>{t("moreStable")}</span>
            </div>
            <FormControl>
              <div className="flex items-center gap-3">
                <Slider
                  id="stability"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[field.value]}
                  onValueChange={(vals) => {
                    field.onChange(vals[0]);
                  }}
                  className="flex-1"
                />
                <span className="text-muted-foreground w-12 text-right text-sm tabular-nums">
                  {(field.value * 100).toFixed(0)}%
                </span>
              </div>
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`${path}.similarity` as Path<T>}
        render={({ field }) => (
          <FormItem className="gap-1.5">
            <SettingLabel
              title={t("similarity")}
              description={t(
                "tts.composer.settings.voice.similarity.description",
              )}
            />
            <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-xs">
              <span>{t("low")}</span>
              <span>{t("high")}</span>
            </div>
            <FormControl>
              <div className="flex items-center gap-3">
                <Slider
                  id="similarity"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[field.value]}
                  onValueChange={(vals) => {
                    field.onChange(vals[0]);
                  }}
                  className="flex-1"
                />
                <span className="text-muted-foreground w-12 text-right text-sm tabular-nums">
                  {(field.value * 100).toFixed(0)}%
                </span>
              </div>
            </FormControl>
          </FormItem>
        )}
      />

      <div className="mt-1 flex items-center justify-between">
        <FormField
          control={control}
          name={`${path}.boost` as Path<T>}
          render={({ field }) => (
            <FormItem className="flex items-center gap-2.5 space-y-0">
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <SettingLabel
                title={t("speakerBoost")}
                description={t(
                  "tts.composer.settings.voice.speakerBoost.description",
                )}
              />
            </FormItem>
          )}
        />

        <Button variant="outline" className="gap-2" onClick={onReset}>
          <Icons.Undo2 className="size-4" />
          {t("reset")}
        </Button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <Popover>
        <PopoverTrigger asChild>{renderTrigger()}</PopoverTrigger>
        <PopoverPortal>
          <PopoverContent className="w-fit min-w-96 px-5">
            {renderContent()}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    );
  }

  return (
    <Drawer>
      <DrawerTrigger asChild>{renderTrigger()}</DrawerTrigger>
      <DrawerContent className="gap-4 px-5 pb-6">
        {renderContent()}
      </DrawerContent>
    </Drawer>
  );
};
