import { MODELS } from "@turbostarter/ai/image/constants";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@turbostarter/ui-web/popover";

import type { ImageGeneration } from "../../use-image-generation";

interface DetailsProps {
  readonly generation: ImageGeneration;
}

export const Details = ({ generation }: DetailsProps) => {
  const { t, i18n } = useTranslation("common");

  const model = MODELS.find(
    (model) => model.id === generation.input?.options.model,
  );

  if (!model) {
    return null;
  }

  const aspectRatio = model.dimensions.find(
    (dimension) => dimension.id === generation.input?.options.aspectRatio,
  );

  const data = [
    {
      label: t("model"),
      value: model.name,
    },
    {
      label: t("aspectRatio"),
      value: generation.input?.options.aspectRatio
        ? `${t(generation.input.options.aspectRatio)} (${aspectRatio?.value})`
        : "---",
    },
    {
      label: t("count"),
      value: generation.input?.options.count,
    },
    {
      label: t("createdAt"),
      value: generation.createdAt?.toLocaleString(i18n.language),
    },
    {
      label: t("completedAt"),
      value: generation.completedAt?.toLocaleString(i18n.language) ?? "---",
    },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Icons.Info className="size-4" />
          <span className="hidden @lg:block">{t("details")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3 p-4">
        {data.map((item) => (
          <div key={item.label} className="flex flex-col items-start gap-1">
            <span className="text-muted-foreground text-xs">{item.label}</span>
            <span className="font-medium">{item.value}</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};
