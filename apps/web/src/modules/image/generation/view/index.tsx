"use client";

import { MODELS } from "@turbostarter/ai/image/constants";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import { ScrollArea } from "@turbostarter/ui-web/scroll-area";

import { ProviderIcons } from "~/modules/common/ai/icons";
import { Stopwatch } from "~/modules/common/stopwatch";

import { useImageGeneration } from "../../use-image-generation";

import { Details } from "./details";
import { Images } from "./images";

import type { ImageGeneration } from "../../use-image-generation";

interface ViewGenerationProps {
  id: string;
  initialGeneration?: ImageGeneration;
}

export const ViewGeneration = ({
  id,
  initialGeneration,
}: ViewGenerationProps) => {
  const { t } = useTranslation(["common", "ai"]);
  const { generation, stop, reload } = useImageGeneration({
    id,
    initialGeneration,
  });

  if (!generation) {
    return null;
  }

  const model = MODELS.find(
    (model) => model.id === generation.input?.options.model,
  );

  const Icon = model ? ProviderIcons[model.provider] : null;

  return (
    <ScrollArea className="w-full grow">
      <div className="flex h-full w-full flex-1 flex-col gap-8 px-5 pt-16 pb-5 md:px-6 md:pt-18 md:pb-6">
        <div className="flex flex-col gap-4">
          <div className="flex w-full items-start justify-between">
            <div className="flex flex-col gap-4">
              <div className="ml-px flex items-center gap-3.5">
                {Icon && <Icon className="size-5 shrink-0" />}
                <span className="text-lg font-medium">{model?.name}</span>
              </div>
              <span className="text-5xl font-semibold">
                {generation.createdAt && !generation.completedAt && (
                  <Stopwatch startTime={generation.createdAt} key={id} />
                )}
                {generation.completedAt &&
                  (
                    (generation.completedAt.getTime() -
                      (generation.createdAt?.getTime() ?? 0)) /
                    1000
                  ).toFixed(1)}
                {`s`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Details generation={generation} />

              {generation.completedAt ? (
                <Button className="gap-2" onClick={reload}>
                  <Icons.RefreshCcw className="size-4" />
                  <span className="hidden @lg:block">{t("regenerate")}</span>
                </Button>
              ) : (
                <Button className="gap-2" onClick={stop}>
                  <Icons.Square className="size-4 fill-current" />
                  <span className="hidden @lg:block">{t("stop")}</span>
                </Button>
              )}
            </div>
          </div>

          <p className="text-muted-foreground text-2xl italic @xl:text-3xl">
            “{generation.input?.prompt}”
          </p>
        </div>

        {["created", "loading"].includes(generation.status ?? "") ? (
          <Images.Layout>
            <Images.Loading
              aspectRatio={generation.input?.options.aspectRatio}
              count={generation.input?.options.count}
            />
          </Images.Layout>
        ) : generation.status === "error" ? (
          <Images.Error onRetry={reload} />
        ) : generation.images?.length ? (
          <Images.Layout>
            <Images.Grid
              images={generation.images.map((image) => ({
                ...image,
                generationId: id,
                description: generation.input?.prompt,
                aspectRatio: generation.input?.options.aspectRatio,
                model: generation.input?.options.model,
              }))}
            />
          </Images.Layout>
        ) : (
          <Images.Empty />
        )}
      </div>
    </ScrollArea>
  );
};
