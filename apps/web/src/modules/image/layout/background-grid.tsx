import Image from "next/image";

import { cn } from "@turbostarter/ui";
import { Marquee } from "@turbostarter/ui-web/marquee";

const images = [
  "https://images.unsplash.com/photo-1493612276216-ee3925520721",
  "https://images.unsplash.com/photo-1731964877414-217cdc9b5b37",
  "https://images.unsplash.com/photo-1513542789411-b6a5d4f31634",
  "https://images.unsplash.com/photo-1485550409059-9afb054cada4",
  "https://images.unsplash.com/photo-1459411552884-841db9b3cc2a",
  "https://images.unsplash.com/photo-1726455083595-fb3d23fa3d2d",
  "https://images.unsplash.com/photo-1494059980473-813e73ee784b",
  "https://images.unsplash.com/photo-1741515277598-64b4da5d212a",
  "https://images.unsplash.com/photo-1524856949007-80db29955b17",
  "https://images.unsplash.com/photo-1605142859862-978be7eba909",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
  "https://images.unsplash.com/photo-1536697246787-1f7ae568d89a",
  "https://images.unsplash.com/photo-1501426026826-31c667bdf23d",
  "https://images.unsplash.com/photo-1554570731-63bcddda4dcd",
  "https://images.unsplash.com/photo-1504275107627-0c2ba7a43dba",
  "https://images.unsplash.com/photo-1741533699135-b3ef83e27215",
  "https://images.unsplash.com/photo-1740532501882-5766c265f637",
  "https://images.unsplash.com/photo-1560963619-c9e49c9380bd",
  "https://images.unsplash.com/photo-1624239408355-7b06ee576e95",
  "https://images.unsplash.com/photo-1468971050039-be99497410af",
];

const chunkSize = Math.ceil(images.length / 4);
const firstRow = images.slice(0, chunkSize);
const secondRow = images.slice(chunkSize, chunkSize * 2);
const thirdRow = images.slice(chunkSize * 2, chunkSize * 3);
const fourthRow = images.slice(chunkSize * 3);

const ImageCard = ({ src }: { src: string }) => {
  return (
    <div
      className={cn(
        "relative aspect-square w-80 cursor-pointer overflow-hidden rounded-xl border",
      )}
    >
      <Image className="object-cover" alt="" src={src} fill />
    </div>
  );
};

export function BackgroundGrid() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-xl">
      <div className="bg-background/50 absolute inset-0 z-10 backdrop-blur-md"></div>
      <div className="absolute -top-20 left-0 w-full rotate-[-5deg]">
        <Marquee>
          {firstRow.map((src, index) => (
            <ImageCard key={`first-row-${index}`} src={src} />
          ))}
        </Marquee>
      </div>
      <div className="absolute top-[20%] left-0 w-full rotate-[3deg]">
        <Marquee reverse>
          {secondRow.map((src, index) => (
            <ImageCard key={`second-row-${index}`} src={src} />
          ))}
        </Marquee>
      </div>
      <div className="absolute top-[calc(50%-5rem)] left-0 w-full rotate-[-4deg]">
        <Marquee>
          {thirdRow.map((src, index) => (
            <ImageCard key={`third-row-${index}`} src={src} />
          ))}
        </Marquee>
      </div>
      <div className="absolute -bottom-10 left-0 w-full rotate-[6deg]">
        <Marquee reverse>
          {fourthRow.map((src, index) => (
            <ImageCard key={`fourth-row-${index}`} src={src} />
          ))}
        </Marquee>
      </div>
      <div className="from-background pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r"></div>
      <div className="from-background pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-gradient-to-l"></div>
    </div>
  );
}
