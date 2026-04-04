import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import * as z from "zod";
import { create } from "zustand";

import { useTranslation } from "@turbostarter/i18n";
import { generateId } from "@turbostarter/shared/utils";

import { uploadWithRetry } from "~/utils";

const MAX_FILE_SIZE_IN_MB = 5;
const MAX_FILE_SIZE = MAX_FILE_SIZE_IN_MB * 1024 * 1024;
const MAX_FILES_COUNT = 5;
const ACCEPTED_FILE_TYPES = [
  "image/png",
  "image/gif",
  "image/jpeg",
  "image/webp",
  "image/jpg",
];

const useValidation = () => {
  const { t } = useTranslation(["validation"]);

  const fileSchema = z
    .instanceof(File)
    .refine((file) => ACCEPTED_FILE_TYPES.includes(file.type), {
      message: t("error.file.type", {
        type: "image",
      }),
    })
    .refine((file) => file.size <= MAX_FILE_SIZE, {
      message: t("error.tooBig.file.notInclusive", {
        size: MAX_FILE_SIZE_IN_MB,
      }),
    });

  const validate = (files: File[], attachments: File[]) => {
    const errors = new Set<string>();
    Array.from(files).forEach((file) => {
      try {
        fileSchema.parse(file);
      } catch (error) {
        if (error instanceof z.ZodError && error.issues[0]) {
          errors.add(error.issues[0].message);
        }
      }
    });

    if (files.length + attachments.length > MAX_FILES_COUNT) {
      errors.add(
        t("error.file.maxCount", {
          count: MAX_FILES_COUNT,
        }),
      );
    }

    return {
      errors,
      files: files
        .filter((file) => fileSchema.safeParse(file).success)
        .slice(0, MAX_FILES_COUNT - attachments.length)
        .map((file) => new File([file], generateId(), { type: file.type })),
    };
  };

  return { validate };
};

interface AttachmentsState {
  attachments: File[];
  setAttachments: (attachments: File[]) => void;
}

export const useAttachmentsStore = create<AttachmentsState>((set) => ({
  attachments: [],
  setAttachments: (attachments) => set({ attachments }),
}));

export const useAttachments = () => {
  const { validate } = useValidation();
  const { attachments, setAttachments } = useAttachmentsStore();

  const upload = useMutation({
    mutationFn: async ({ directory }: { directory: string }) => {
      setAttachments([]);
      await Promise.allSettled(
        attachments.map((attachment) =>
          uploadWithRetry({
            path: `${directory}/${attachment.name}.${
              attachment.type.split("/")[1] ?? "png"
            }`,
            file: attachment,
          }),
        ),
      );
    },
    onError: (error) => {
      console.error(error);
    },
  });

  const onAdd = useCallback(
    (files: File[]) => {
      const { errors, files: filesToAdd } = validate(files, attachments);

      for (const error of errors) {
        toast.error(error);
      }

      if (!filesToAdd.length) {
        return;
      }

      setAttachments([...attachments, ...filesToAdd]);
    },
    [attachments, setAttachments, validate],
  );

  const onRemove = useCallback(
    (file: File) => {
      setAttachments(attachments.filter((a) => a.name !== file.name));
    },
    [attachments, setAttachments],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      const items = event.clipboardData.items;

      const files = Array.from(items)
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (files.length > 0) {
        onAdd(files);
      }
    },
    [onAdd],
  );

  const onClear = useCallback(() => {
    setAttachments([]);
  }, [setAttachments]);

  return { attachments, upload, onAdd, onRemove, onPaste, onClear };
};
