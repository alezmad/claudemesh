"use client";

import { AspectRatio } from "@turbostarter/ai/image/types";
import { useTranslation } from "@turbostarter/i18n";
import { FormControl, FormField, FormItem } from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@turbostarter/ui-web/select";

import type { Control, FieldValues, Path } from "react-hook-form";

const icons = {
  [AspectRatio.SQUARE]: Icons.Square,
  [AspectRatio.STANDARD]: Icons.Square,
  [AspectRatio.LANDSCAPE]: Icons.RectangleHorizontal,
  [AspectRatio.PORTRAIT]: Icons.RectangleVertical,
};

interface AspectSelectorProps<T extends FieldValues> {
  readonly control: Control<T>;
  readonly name: Path<T>;
  readonly options: readonly {
    readonly id: AspectRatio;
    readonly value: string;
  }[];
}

export const AspectSelector = <T extends FieldValues>({
  name,
  control,
  options,
}: AspectSelectorProps<T>) => {
  const { t } = useTranslation("common");
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="max-w-24 min-w-0 @sm:max-w-none">
          <FormControl>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPortal>
                <SelectContent align="end">
                  {options.map(({ id, value }) => {
                    const Icon = icons[id];

                    return (
                      <SelectItem key={id} value={id}>
                        <div className="flex items-center gap-2.5">
                          <Icon className="size-4 shrink-0" />
                          <span className="min-w-0 truncate font-medium">
                            <span className="hidden @lg:inline">
                              {t(
                                id.toLowerCase() as Lowercase<
                                  keyof typeof AspectRatio
                                >,
                              )}{" "}
                            </span>
                            <span>{`(${value})`}</span>
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </SelectPortal>
            </Select>
          </FormControl>
        </FormItem>
      )}
    />
  );
};
