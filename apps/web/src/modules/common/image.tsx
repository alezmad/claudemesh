/* eslint-disable @next/next/no-img-element */
import { motion } from "motion/react";
import { memo, useCallback, useEffect, useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { buttonVariants } from "@turbostarter/ui-web/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
} from "@turbostarter/ui-web/dialog";
import { Icons } from "@turbostarter/ui-web/icons";
import { Skeleton } from "@turbostarter/ui-web/skeleton";

export const Thumbnail = ({
  index,
  className,
  ...props
}: React.ComponentProps<typeof motion.button> & { index?: number }) => {
  return (
    <motion.button
      className={cn(
        "group/thumbnail relative cursor-pointer overflow-hidden rounded-lg",
        "ring-offset-background hover:ring-primary focus:ring-primary hover:ring-2 hover:ring-offset-2 focus:ring-2 focus:ring-offset-2",
        "transition-all duration-200",
        "bg-primary/5 dark:bg-primary/10 shadow-xs",
        className,
      )}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: (index ?? 0) * 0.1 }}
      {...props}
    />
  );
};

export const ThumbnailImage = ({
  className,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <img
        className={cn(
          "h-full w-full object-cover object-center",
          "opacity-0 transition-all duration-500",
          loaded && "opacity-100",
          className,
        )}
        onLoad={() => {
          setLoaded(true);
        }}
        {...props}
      />
      {!loaded && <Skeleton className="absolute inset-0" />}
    </>
  );
};

interface ImageSource {
  url?: string | null;
  base64?: string | null;
}

export const getImageSource = (image: ImageSource) => {
  if (image.url) {
    return image.url;
  }
  if (image.base64) {
    return `data:image/jpeg;base64,${image.base64}`;
  }
  return "";
};

interface ViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: (ImageSource & { description?: string | null })[];
  selectedImage: number;
  setSelectedImage: (index: number) => void;
}

export const Viewer = memo<ViewerProps>(
  ({ open, onOpenChange, images, selectedImage, setSelectedImage }) => {
    const { t } = useTranslation("common");
    const currentImage = images[selectedImage];

    const navigatePrevious = useCallback(() => {
      if (images.length <= 1) return;
      setSelectedImage(
        selectedImage === 0 ? images.length - 1 : selectedImage - 1,
      );
    }, [images.length, selectedImage, setSelectedImage]);

    const navigateNext = useCallback(() => {
      if (images.length <= 1) return;
      setSelectedImage(
        selectedImage === images.length - 1 ? 0 : selectedImage + 1,
      );
    }, [images.length, selectedImage, setSelectedImage]);

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!open || images.length <= 1) return;

        if (event.key === "ArrowLeft") {
          navigatePrevious();
        } else if (event.key === "ArrowRight") {
          navigateNext();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [open, selectedImage, images.length, navigatePrevious, navigateNext]);

    if (!currentImage) {
      return null;
    }

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="h-full w-full max-w-full border-none bg-transparent p-0 shadow-none sm:max-w-full"
          showCloseButton={false}
        >
          <div className="relative flex grow flex-col gap-4">
            <div className="flex grow items-center justify-center">
              {images.length > 1 && (
                <button
                  className="group flex h-full cursor-pointer items-center justify-center p-2 backdrop-blur-sm transition-all hover:backdrop-blur-md md:p-3"
                  onClick={navigatePrevious}
                  aria-label={t("previous")}
                >
                  <div
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "bg-background/50 text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground size-10 border-0 p-0 backdrop-blur-md md:-left-6 md:size-12",
                    )}
                  >
                    <Icons.ChevronLeft className="size-6 md:size-7" />
                  </div>
                </button>
              )}

              <div className="relative flex w-full grow items-center justify-center px-2">
                <motion.img
                  key={getImageSource(currentImage)} // Use a stable key like the source
                  src={getImageSource(currentImage)}
                  alt={currentImage.description ?? ""}
                  className="h-full max-h-[70vh] w-full rounded-lg object-contain"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  fetchPriority="high"
                />
              </div>

              {images.length > 1 && (
                <button
                  className="group flex h-full cursor-pointer items-center justify-center p-2 backdrop-blur-sm transition-all hover:backdrop-blur-md md:p-3"
                  onClick={navigateNext}
                  aria-label={t("next")}
                >
                  <div
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "bg-background/50 text-muted-foreground group-hover:bg-accent group-hover:text-accent-foreground size-10 border-0 p-0 backdrop-blur-md md:-left-6 md:size-12",
                    )}
                  >
                    <Icons.ChevronRight className="size-6 md:size-7" />
                  </div>
                </button>
              )}
            </div>

            {currentImage.description && (
              <div className="absolute right-3 bottom-4 left-3 md:bottom-6 lg:bottom-8">
                <p className="bg-background/75 mx-auto max-w-3xl rounded-2xl border px-6 py-4 text-center text-xs leading-normal backdrop-blur-md backdrop-saturate-150 md:text-sm">
                  {currentImage.description}
                </p>
              </div>
            )}
          </div>

          <DialogClose className="absolute top-3 right-3 md:top-3.5 md:right-3.5">
            <Icons.X />
            <span className="sr-only">{t("close")}</span>
          </DialogClose>
        </DialogContent>
      </Dialog>
    );
  },
);

Viewer.displayName = "Viewer";
