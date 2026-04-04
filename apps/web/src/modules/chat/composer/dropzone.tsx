"use client";

import { motion } from "motion/react";
import { memo } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { Icons } from "@turbostarter/ui-web/icons";

import { Attachments } from "~/modules/common/ai/composer/attachments";

import { useAttachments } from "./hooks/use-attachments";

const DropzoneDialog = () => {
  const { t } = useTranslation("ai");

  return (
    <motion.div
      className="bg-background relative z-10 mx-6 flex flex-col items-center justify-center rounded-xl border p-6 py-8 sm:p-8 sm:py-10 md:px-12 md:py-10"
      initial={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: 10 }}
      transition={{ duration: 0.2 }}
    >
      <Icons.ImagePlus className="text-muted-foreground size-12" />
      <span className="mt-3 text-lg font-medium">
        {t("chat.composer.files.dropzone.title")}
      </span>
      <p className="text-muted-foreground text-center">
        {t("chat.composer.files.dropzone.description")}
      </p>
    </motion.div>
  );
};

interface ChatDropzoneProps {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
}

export const ChatDropzone = memo<ChatDropzoneProps>(
  ({ children, disabled }) => {
    const { onAdd } = useAttachments();

    return (
      <Attachments.Dropzone
        onDrop={onAdd}
        dialog={<DropzoneDialog />}
        disabled={disabled}
      >
        {children}
      </Attachments.Dropzone>
    );
  },
);

ChatDropzone.displayName = "ChatDropzone";
