"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { MAX_FILE_SIZE_IN_MB } from "@turbostarter/ai/pdf/constants";
import {
  pdfUrlFormSchema,
  validateRemotePdfUrl,
} from "@turbostarter/ai/pdf/schema";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import { Input } from "@turbostarter/ui-web/input";

import type { PdfUrlFormPayload } from "@turbostarter/ai/pdf/schema";
import type { RemoteFile } from "@turbostarter/ai/pdf/types";

interface PdfUrlFormProps {
  readonly onSuccess: (file: RemoteFile) => void;
}

export const PdfUrlForm = ({ onSuccess }: PdfUrlFormProps) => {
  const { t } = useTranslation(["common", "ai", "validation"]);
  const form = useForm({
    resolver: zodResolver(pdfUrlFormSchema),
    defaultValues: {
      url: "",
    },
  });

  async function onSubmit(values: PdfUrlFormPayload) {
    const result = await validateRemotePdfUrl(values.url);

    if (typeof result === "string") {
      return form.setError("url", {
        message: t(result, { maximum: MAX_FILE_SIZE_IN_MB, type: "PDF" }),
      });
    }

    onSuccess(result);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex w-full gap-2"
      >
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormControl>
                <Input
                  autoFocus
                  placeholder={t("pdf.upload.fromUrl.placeholder")}
                  className="bg-background"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="rounded-md"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <Icons.Loader2 className="size-5 animate-spin" />
          ) : (
            t("pdf.upload.fromUrl.cta")
          )}
        </Button>
      </form>
    </Form>
  );
};
