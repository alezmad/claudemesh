"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorCode, useDropzone as useReactDropzone } from "react-dropzone";
import { toast } from "sonner";

import {
  EXAMPLE_PDF,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_IN_MB,
} from "@turbostarter/ai/pdf/constants";
import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { GridPattern } from "@turbostarter/ui-web/grid-pattern";
import { Icons } from "@turbostarter/ui-web/icons";

import { PdfUploadConfirm } from "~/modules/pdf/upload/confirm";

import { PdfUrlForm } from "./url-form";

import type { FileInput } from "./utils";

const useDropzone = ({ onDrop }: { onDrop: (files: File[]) => void }) => {
  const { t } = useTranslation("validation");

  const errorMessages = useMemo(
    () => ({
      [ErrorCode.FileInvalidType]: t("error.file.type", {
        type: "PDF",
      }),
      [ErrorCode.FileTooLarge]: t("error.tooBig.file.notInclusive", {
        maximum: MAX_FILE_SIZE_IN_MB,
      }),
      [ErrorCode.FileTooSmall]: t("error.tooSmall.file.notInclusive", {
        minimum: 0,
      }),
      [ErrorCode.TooManyFiles]: t("error.file.maxCount", {
        count: 1,
      }),
    }),
    [t],
  );

  const dropzone = useReactDropzone({
    accept: {
      "application/pdf": [".pdf"],
    },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE * 1024 * 1024,
    onError: (error) => toast.error(error.message),
    noClick: true,
    noKeyboard: true,
    onDrop,
  });

  useEffect(() => {
    const code = dropzone.fileRejections[0]?.errors[0]?.code;
    if (code) {
      toast.error(errorMessages[code as ErrorCode]);
    }
  }, [dropzone.fileRejections, errorMessages]);

  return dropzone;
};

export const PdfUpload = () => {
  const [file, setFile] = useState<FileInput | null>(null);
  const { t } = useTranslation(["ai", "common"]);
  const { open, getRootProps, getInputProps, isDragAccept, isDragReject } =
    useDropzone({ onDrop: (files) => setFile(files[0] ?? null) });

  if (file) {
    return (
      <Layout>
        <PdfUploadConfirm file={file} onCancel={() => setFile(null)} />
      </Layout>
    );
  }

  return (
    <Layout
      {...getRootProps()}
      className={cn(
        { "border-destructive": isDragReject },
        { "border-muted-foreground": isDragAccept },
      )}
    >
      <input {...getInputProps()} />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center justify-center gap-3">
        <Icons.FileText className="size-16" />
        <h1 className="text-4xl font-medium tracking-tight">
          {t("pdf.title")}
        </h1>
        <p className="text-muted-foreground mb-6 max-w-sm text-center text-sm">
          {t("pdf.upload.description")}
        </p>

        <PdfUrlForm onSuccess={setFile} />
        <Button
          className="bg-background w-full rounded-md"
          variant="outline"
          onClick={open}
        >
          {t("pdf.upload.fromDevice")}
        </Button>

        <span className="text-muted-foreground text-sm">{t("or")}</span>

        <Button
          variant="outline"
          className="bg-background h-auto w-full gap-3 overflow-hidden rounded-md px-2 pr-4"
          onClick={() => setFile(EXAMPLE_PDF)}
        >
          <div className="bg-muted rounded-md border p-1.5">
            <Icons.Paperclip className="size-4 shrink-0" />
          </div>
          <div className="mr-auto flex min-w-0 flex-col items-start">
            <span>{t("pdf.upload.example.cta")}</span>
            <span className="text-muted-foreground w-full truncate pr-4 text-xs">
              {EXAMPLE_PDF.url}
            </span>
          </div>
          <Icons.ArrowRight className="size-4 shrink-0" />
        </Button>
      </div>
    </Layout>
  );
};

const Layout = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed p-4",
        className,
      )}
      {...props}
    >
      {children}
      <GridPattern
        width={50}
        height={50}
        x={-1}
        y={-1}
        strokeDasharray={"4 2"}
        className="mask-[radial-gradient(white,transparent)]"
      />
    </div>
  );
};
