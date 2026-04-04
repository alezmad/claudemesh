"use client";

import { FormControl, FormField, FormItem } from "@turbostarter/ui-web/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@turbostarter/ui-web/select";

import { ProviderIcons } from "~/modules/common/ai/icons";

import type { Provider } from "@turbostarter/ai";
import type { Control, FieldValues, Path } from "react-hook-form";

interface ModelSelectorProps<T extends FieldValues> {
  readonly control: Control<T>;
  readonly name: Path<T>;
  readonly options: readonly {
    readonly id: string;
    readonly name: string;
    readonly provider: Provider;
  }[];
}

export const ModelSelector = <T extends FieldValues>({
  name,
  control,
  options,
}: ModelSelectorProps<T>) => {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormControl>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPortal>
                <SelectContent align="end">
                  {options.map((option) => {
                    const Icon = ProviderIcons[option.provider];

                    return (
                      <SelectItem key={option.id} value={option.id}>
                        <div className="flex items-center gap-2.5">
                          <Icon className="text-foreground size-4 shrink-0" />
                          <span className="min-w-0 truncate font-medium">
                            {option.name}
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
