"use client";

import { motion } from "motion/react";
import { AnimatePresence } from "motion/react";
import { createContext, memo, useContext, useMemo } from "react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@turbostarter/ui-web/avatar";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { Viewer } from "~/modules/common/image";

import type { DropzoneOptions, DropzoneState } from "react-dropzone";

const DropzoneContext = createContext<{
  dropzone: DropzoneState;
} | null>(null);

interface DropzoneProps extends DropzoneOptions {
  children: React.ReactNode;
  dialog?: React.ReactNode;
}

const Dropzone = ({ children, dialog, ...options }: DropzoneProps) => {
  const dropzone = useDropzone({
    accept: {
      "image/*": [".png", ".gif", ".jpeg", ".webp", ".jpg"],
    },
    onError: (error) => toast.error(error.message),
    noClick: true,
    noKeyboard: true,
    multiple: true,
    ...options,
  });

  return (
    <DropzoneContext.Provider value={{ dropzone }}>
      <div {...dropzone.getRootProps()} className="relative h-full w-full">
        {children}

        <AnimatePresence>
          {dropzone.isDragActive && dialog && (
            <div className="absolute inset-0 z-50 flex items-center justify-center">
              <motion.div
                className="bg-background/50 absolute inset-0 backdrop-blur-sm md:rounded-lg"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
              />

              {dialog}
            </div>
          )}
        </AnimatePresence>
      </div>
    </DropzoneContext.Provider>
  );
};

const Input = memo<React.ButtonHTMLAttributes<HTMLButtonElement>>((props) => {
  const { t } = useTranslation(["ai", "common"]);
  const context = useContext(DropzoneContext);

  return (
    <>
      <input
        {...context?.dropzone.getInputProps()}
        disabled={props.disabled ?? false}
      />
      <TooltipProvider>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              type="button"
              {...props}
              className={cn(
                "text-muted-foreground shrink-0 rounded-full dark:bg-transparent",
                props.className,
              )}
              onClick={(event) => {
                context?.dropzone.open();
                props.onClick?.(event);
              }}
            >
              <Icons.Paperclip className="size-4" />
              <span className="sr-only">{t("chat.composer.files.add")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{t("chat.composer.files.add")}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
});

Input.displayName = "Input";

interface PreviewProps extends React.HTMLAttributes<HTMLDivElement> {
  attachments: File[];
  onRemove: (file: File) => void;
}

export const Preview = memo<PreviewProps>(
  ({ attachments, onRemove, className, ...props }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedImage, setSelectedImage] = useState(0);

    if (!attachments.length) {
      return null;
    }

    return (
      <>
        <div
          className={cn(
            "-mb-2.5 flex w-full flex-wrap gap-3 px-2 pt-4 @[480px]/input:px-2.5",
            className,
          )}
          {...props}
        >
          {attachments.map((attachment, index) => (
            <Thumbnail
              key={attachment.name}
              attachment={attachment}
              onRemove={() => onRemove(attachment)}
              onClick={() => {
                setSelectedImage(index);
                setIsOpen(true);
              }}
            />
          ))}
        </div>

        <Viewer
          open={isOpen}
          onOpenChange={setIsOpen}
          images={attachments.map((attachment) => ({
            url: URL.createObjectURL(attachment),
          }))}
          selectedImage={selectedImage}
          setSelectedImage={setSelectedImage}
        />
      </>
    );
  },
);

Preview.displayName = "Preview";

interface ThumbnailProps extends React.HTMLAttributes<HTMLButtonElement> {
  attachment: File;
  onRemove: () => void;
}

const Thumbnail = memo<ThumbnailProps>(({ attachment, onRemove, ...props }) => {
  const { t } = useTranslation(["ai"]);
  const preview = useMemo(() => URL.createObjectURL(attachment), [attachment]);

  return (
    <div className="group relative">
      <button {...props} type="button">
        <Avatar className="size-16 shrink-0 rounded-xl">
          <AvatarImage
            src={preview}
            alt={`Preview of ${attachment.name}`}
            className="rounded-xl border object-cover"
          />
          <AvatarFallback className="rounded-xl">
            <Icons.Image className="text-muted-foreground size-8" />
          </AvatarFallback>
        </Avatar>

        <span className="sr-only">{t("chat.composer.files.preview")}</span>
      </button>

      <TooltipProvider>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="bg-card dark:bg-card absolute top-0 right-0 size-5 translate-x-1/3 -translate-y-1/3 p-1"
              onClick={onRemove}
              type="button"
            >
              <Icons.X className="size-full" />
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="rounded-md px-2 py-1 text-xs"
          >
            <span>{t("chat.composer.files.remove")}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
});

Thumbnail.displayName = "Thumbnail";

export const Attachments = {
  Input,
  Dropzone,
  Preview,
};
