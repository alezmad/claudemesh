import { useState } from "react";

import { cn } from "@turbostarter/ui";
import { useBreakpoint } from "@turbostarter/ui-web";

import { Thumbnail, ThumbnailImage, Viewer } from "~/modules/common/image";

import type { SearchResult } from ".";

type SearchImage = SearchResult["images"][number];

export const PREVIEW_IMAGE_COUNT = {
  MOBILE: 4,
  DESKTOP: 5,
};

interface ImageGridProps {
  images: SearchImage[];
  showAll?: boolean;
}

const ImageThumbnail = ({
  image,
  index,
  onClick,
  isLast,
  hasMore,
  moreCount,
}: {
  image: SearchImage;
  index: number;
  onClick: () => void;
  isLast: boolean;
  hasMore: boolean;
  moreCount: number;
}) => (
  <Thumbnail onClick={onClick} index={index}>
    <ThumbnailImage src={image.url} alt={image.description} />
    {image.description && (!isLast || !hasMore) && (
      <div className="absolute inset-0 flex items-end bg-black/60 px-3 py-4 opacity-0 transition-opacity duration-200 group-hover/thumbnail:opacity-100">
        <p className="line-clamp-3 text-xs text-white">{image.description}</p>
      </div>
    )}
    {isLast && hasMore && (
      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
        <span className="text-sm font-medium text-white">+{moreCount}</span>
      </div>
    )}
  </Thumbnail>
);

export const ImageGrid = ({ images, showAll = false }: ImageGridProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const isDesktop = useBreakpoint("md");

  const displayImages = showAll
    ? images
    : images.slice(
        0,
        isDesktop ? PREVIEW_IMAGE_COUNT.DESKTOP : PREVIEW_IMAGE_COUNT.MOBILE,
      );
  const hasMore =
    images.length >
    (isDesktop ? PREVIEW_IMAGE_COUNT.DESKTOP : PREVIEW_IMAGE_COUNT.MOBILE);

  return (
    <div>
      <div
        className={cn(
          "grid gap-2",
          "grid-cols-2",
          displayImages.length === 1 && "grid-cols-1",
          "sm:grid-cols-3",
          "lg:grid-cols-4",
          "*:aspect-4/3",
          "[&>*:first-child]:col-span-1 [&>*:first-child]:row-span-1",
          isDesktop &&
            displayImages.length > 1 &&
            "[&>*:first-child]:col-span-2 [&>*:first-child]:row-span-2",
          displayImages.length === 1 &&
            "grid-cols-1! [&>*:first-child]:col-span-1! [&>*:first-child]:row-span-2!",
        )}
      >
        {displayImages.map((image, index) => (
          <ImageThumbnail
            key={index}
            image={image}
            index={index}
            onClick={() => {
              setSelectedImage(index);
              setIsOpen(true);
            }}
            isLast={index === displayImages.length - 1}
            hasMore={!showAll && hasMore}
            moreCount={images.length - displayImages.length}
          />
        ))}
      </div>

      <Viewer
        open={isOpen}
        onOpenChange={setIsOpen}
        images={images}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
      />
    </div>
  );
};
