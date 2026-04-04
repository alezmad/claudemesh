import { useMutation } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { AspectRatio } from "@turbostarter/ai/image/types";
import { useTranslation } from "@turbostarter/i18n";
import { splitArray } from "@turbostarter/shared/utils";
import { cn } from "@turbostarter/ui";
import { Badge } from "@turbostarter/ui-web/badge";
import { Button, buttonVariants } from "@turbostarter/ui-web/button";
import { GridPattern } from "@turbostarter/ui-web/grid-pattern";
import { Icons } from "@turbostarter/ui-web/icons";
import { Skeleton } from "@turbostarter/ui-web/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { pathsConfig } from "~/config/paths";
import {
  getImageSource,
  Thumbnail,
  ThumbnailImage,
  Viewer,
} from "~/modules/common/image";
import { TurboLink } from "~/modules/common/turbo-link";
import { shareOrDownload } from "~/utils";

import type { ImageGenerationImage } from "../../use-image-generation";

const getAspectRatioClass = (aspectRatio?: AspectRatio) => {
  switch (aspectRatio) {
    case AspectRatio.SQUARE:
      return "aspect-square";
    case AspectRatio.STANDARD:
      return "aspect-[4/3]";
    case AspectRatio.PORTRAIT:
      return "aspect-[9/16]";
    case AspectRatio.LANDSCAPE:
      return "aspect-[16/9]";
    default:
      return "aspect-square";
  }
};

const ColumnsContext = createContext<number>(0);

const Layout = ({ children }: { children: React.ReactNode }) => {
  const [columns, setColumns] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const getColumnsCount = () => {
    if (!ref.current) {
      return 0;
    }

    setColumns(
      window
        .getComputedStyle(ref.current)
        .getPropertyValue("grid-template-columns")
        .split(" ").length,
    );
  };

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    getColumnsCount();
    const resizeObserver = new ResizeObserver(getColumnsCount);
    resizeObserver.observe(ref.current);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <ColumnsContext.Provider value={columns}>
      <div
        className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-4"
        ref={ref}
      >
        {children}
      </div>
    </ColumnsContext.Provider>
  );
};

interface GridProps {
  readonly images: (ImageGenerationImage & {
    generationId: string;
    description?: string;
    aspectRatio?: AspectRatio;
    model?: string;
  })[];
  readonly fetching?: boolean;
  readonly withDetails?: boolean;
}

const Grid = ({ images, fetching, withDetails }: GridProps) => {
  const { t } = useTranslation(["ai", "common"]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const columns = useContext(ColumnsContext);

  const share = useMutation({
    mutationFn: (image: (typeof images)[number]) =>
      shareOrDownload({
        url: getImageSource(image),
        filename: `${image.model ?? "image"}-${Date.now()}.png`,
      }),
    onError: () => toast.error(t("error.general")),
  });

  const chunks = useMemo(() => splitArray(images, columns), [images, columns]);

  return (
    <>
      {chunks.map((chunk, chunkIndex) => (
        <div key={chunkIndex} className="flex w-full flex-col gap-2.5">
          {chunk.map((image, imageIndex) => {
            const index = images.findIndex(
              (img) =>
                (img.url && img.url === image.url) ??
                (img.base64 && img.base64 === image.base64),
            );
            return (
              <div className="group relative" key={imageIndex}>
                <Thumbnail
                  index={index}
                  onClick={() => {
                    setIsOpen(true);
                    setSelectedImage(index);
                  }}
                  className={getAspectRatioClass(image.aspectRatio)}
                >
                  {withDetails && (
                    <Badge
                      className="bg-background/75 absolute top-3 left-3 backdrop-blur-md"
                      variant="secondary"
                    >
                      {image.model}
                    </Badge>
                  )}
                  <ThumbnailImage
                    src={getImageSource(image)}
                    alt={image.description ?? ""}
                  />
                </Thumbnail>
                <TooltipProvider>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="bg-background/75 absolute bottom-5 left-3 opacity-0 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 hover:disabled:opacity-50 [@media(hover:none)]:opacity-100"
                        onClick={() => share.mutate(image)}
                        disabled={share.isPending}
                      >
                        {share.isPending ? (
                          <Icons.Loader className="size-4 animate-spin" />
                        ) : (
                          <Icons.Download className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="center" sideOffset={5}>
                      <span>{t("download")}</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {withDetails && (
                  <TooltipProvider>
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <TurboLink
                          target="_blank"
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "icon" }),
                            "bg-background/75 absolute right-3 bottom-5 opacity-0 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 hover:disabled:opacity-50 [@media(hover:none)]:opacity-100",
                          )}
                          href={pathsConfig.apps.image.generation(
                            image.generationId,
                          )}
                        >
                          <Icons.ExternalLink className="size-4" />
                        </TurboLink>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="center"
                        sideOffset={5}
                      >
                        <span>{t("image.generation.goTo")}</span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            );
          })}

          {fetching && (
            <Skeleton className={cn("rounded-lg", getAspectRatioClass())} />
          )}
        </div>
      ))}

      <Viewer
        open={isOpen}
        onOpenChange={setIsOpen}
        images={images}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
      />
    </>
  );
};

const Empty = () => {
  const { t } = useTranslation(["ai"]);

  return (
    <div className="relative flex h-full w-full flex-1 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-4">
      <GridPattern
        width={50}
        height={50}
        x={-1}
        y={-1}
        strokeDasharray={"4 2"}
        className="mask-[radial-gradient(white,transparent)]"
      />

      <Icons.ImageOff className="size-20" />
      <span className="text-2xl font-medium @lg:text-3xl">
        {t("image.generation.empty.title")}
      </span>
      <p className="text-muted-foreground max-w-md text-center text-pretty @lg:text-lg">
        {t("image.generation.empty.description")}
      </p>

      <TurboLink
        href={pathsConfig.apps.image.index}
        className={cn(buttonVariants({ variant: "secondary" }), "mt-3 gap-2")}
      >
        <Icons.Plus className="size-5" />
        {t("image.generation.new")}
      </TurboLink>
    </div>
  );
};

const Loading = ({
  aspectRatio,
  count,
}: {
  aspectRatio?: AspectRatio;
  count?: number;
}) => {
  const columns = useContext(ColumnsContext);

  return (
    <>
      {Array.from({ length: count ?? columns * 2 }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn("rounded-lg", getAspectRatioClass(aspectRatio))}
        />
      ))}
    </>
  );
};

const Error = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation(["ai", "common"]);

  return (
    <div className="border-destructive relative flex h-full w-full flex-1 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4">
      <GridPattern
        width={50}
        height={50}
        x={-1}
        y={-1}
        strokeDasharray={"4 2"}
        className="mask-[radial-gradient(white,transparent)]"
      />
      <Icons.CircleX className="text-destructive size-20" />
      <span className="text-destructive text-2xl font-medium @lg:text-3xl">
        {t("error.title")}
      </span>
      <p className="text-muted-foreground max-w-md py-1 text-center text-pretty @lg:text-lg">
        {t("error.general")}
      </p>
      <Button variant="outline" className="mt-2" onClick={onRetry}>
        <Icons.RefreshCcw className="mr-2 size-4" />
        {t("regenerate")}
      </Button>
    </div>
  );
};

export const Images = {
  Layout,
  Grid,
  Empty,
  Loading,
  Error,
};
