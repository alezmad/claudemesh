import { useMutation } from "@tanstack/react-query";

import { handle } from "@turbostarter/api/utils";
import { useTranslation } from "@turbostarter/i18n";
import { generateId } from "@turbostarter/shared/utils";

import { api } from "~/lib/api/client";
import { authClient } from "~/lib/auth/client";
import { readFile } from "~/modules/pdf/upload/utils";

import type { FileInput } from "~/modules/pdf/upload/utils";

export const useUpload = () => {
  const { t } = useTranslation("ai");
  const { data: session } = authClient.useSession();

  return useMutation({
    mutationFn: async (data: { file: FileInput }) => {
      if (!session?.user.id) {
        throw new Error(t("pdf.upload.error.unauthorized"));
      }

      const path = `documents/${session.user.id}/${generateId()}.pdf`;

      const { url: uploadUrl } = await handle(api.storage.upload.$get)({
        query: { path },
      });

      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: await readFile(data.file),
        headers: {
          "Content-Type": "application/pdf",
        },
      });

      if (!response.ok) {
        throw new Error(t("pdf.upload.error.api"));
      }

      return { path };
    },
  });
};
