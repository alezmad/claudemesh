"use client";

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

interface ImageCountSelectorProps<T extends FieldValues> {
  readonly control: Control<T>;
  readonly name: Path<T>;
  readonly min?: number;
  readonly max?: number;
}

export const ImageCountSelector = <T extends FieldValues>({
  name,
  control,
  min = 1,
  max = 5,
}: ImageCountSelectorProps<T>) => {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0 gap-0">
          <FormControl>
            <Select
              value={`${field.value}`}
              onValueChange={(value) => field.onChange(parseInt(value, 10))}
            >
              <SelectTrigger size="sm">
                <div className="flex items-center gap-2">
                  <Icons.Image className="size-4 shrink-0" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent align="end">
                  {Array.from({ length: max - min + 1 }, (_, i) => i + min).map(
                    (count) => (
                      <SelectItem key={count} value={count.toString()}>
                        <div className="flex items-center gap-2.5">
                          <span className="min-w-0 truncate font-medium">
                            {count}
                          </span>
                        </div>
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </SelectPortal>
            </Select>
          </FormControl>
        </FormItem>
      )}
    />
  );
};
