"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { formatFileSize } from "@turbostarter/ai/pdf/utils";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@turbostarter/ui-web/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import { Input } from "@turbostarter/ui-web/input";

import { pathsConfig } from "~/config/paths";
import { authClient } from "~/lib/auth/client";
import { useAIError } from "~/modules/common/hooks/use-ai-error";

import { pdf } from "../lib/api";

import { useUpload } from "./hooks/use-upload";
import { getFileName } from "./utils";

import type { FileInput } from "./utils";

const formSchema = z.object({
  name: z.string().min(1).max(255),
});

interface PdfUploadConfirmProps {
  readonly file: FileInput;
  readonly onCancel: () => void;
}

export const PdfUploadConfirm = ({ file, onCancel }: PdfUploadConfirmProps) => {
  const { onError } = useAIError();
  const { t } = useTranslation(["common", "ai"]);
  const { data: session, isPending: isSessionLoading } = authClient.useSession();
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: getFileName(file) ?? "",
    },
  });

  const router = useRouter();
  const upload = useUpload();
  const createChat = useMutation({
    ...pdf.mutations.chats.create,
    onSuccess: (data) => {
      toast.success(t("pdf.upload.success"));
      if (data?.id) {
        return router.push(pathsConfig.apps.pdf.chat(data.id));
      }
    },
    onError,
  });

  // Show sign-in prompt for non-authenticated users
  if (!isSessionLoading && !session?.user) {
    return (
      <Card className="relative z-10 flex w-full max-w-xl flex-col justify-center gap-3 overflow-hidden">
        <CardHeader className="flex flex-col items-center gap-1 py-8">
          <Icons.Lock className="mb-2 size-10 text-muted-foreground" />
          <CardTitle>{t("pdf.upload.signIn.title")}</CardTitle>
          <CardDescription className="text-center">
            {t("pdf.upload.signIn.description")}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center gap-2 pb-8">
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button asChild>
            <Link href={pathsConfig.auth.login}>
              {t("pdf.upload.signIn.cta")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const data = [
    {
      title: t("file"),
      value: "url" in file ? file.url : `./${file.name}`,
    },
    {
      title: t("size"),
      value: formatFileSize(file.size),
    },
    {
      title: t("type"),
      value: "PDF",
    },
  ];

  async function onSubmit(values: z.infer<typeof formSchema>) {
    const { path } = await upload.mutateAsync({
      file,
      ...values,
    });

    await createChat.mutateAsync({
      json: {
        ...values,
        path,
      },
    });
  }

  if (form.formState.isSubmitting || form.formState.isSubmitSuccessful) {
    return (
      <Card className="relative z-10 flex w-full max-w-xl flex-col justify-center gap-3 overflow-hidden">
        <CardHeader className="flex flex-col items-center gap-1 py-16">
          <Icons.Loader className="mb-2 size-8 animate-spin" />
          <CardTitle>{t("pdf.upload.loading.title")}</CardTitle>
          <CardDescription>
            {t("pdf.upload.loading.description")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="relative z-10 flex w-full max-w-xl flex-col justify-center gap-3 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle>{t("pdf.upload.confirm.title")}</CardTitle>
        <CardDescription>{t("pdf.upload.confirm.description")}</CardDescription>
      </CardHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent>
            <div className="flex flex-col gap-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-8 @md:gap-12">
                      <FormLabel className="font-medium">
                        {t("name")}:
                      </FormLabel>
                      <FormControl>
                        <Input
                          autoFocus
                          className="h-8 py-0 text-right"
                          {...field}
                        />
                      </FormControl>
                    </div>
                    <FormMessage className="text-right" />
                  </FormItem>
                )}
              />

              {data.map(({ title, value }) => (
                <div
                  key={title}
                  className="mb-0.5 flex items-center justify-between gap-8 text-sm @md:gap-12"
                >
                  <span className="font-medium">{title}:</span>
                  <span className="truncate">{value}</span>
                </div>
              ))}
            </div>
          </CardContent>

          <CardFooter className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="grow @lg:grow-0"
            >
              {t("cancel")}
            </Button>
            <Button type="submit" className="grow @lg:grow-0">
              {t("confirm")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
};
