import * as z from "zod";

import { isKey } from "@turbostarter/i18n";
import { getTranslation } from "@turbostarter/i18n/server";
import { captureException } from "@turbostarter/monitoring-web/server";
import { HttpStatusCode } from "@turbostarter/shared/constants";
import { logger } from "@turbostarter/shared/logger";
import { getStatusCode } from "@turbostarter/shared/utils";

import type { Context } from "hono";

const errorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

const isError = (e: unknown): e is z.infer<typeof errorSchema> => {
  return errorSchema.safeParse(e).success;
};

export const onError = async (
  e: unknown,
  c?: Context<{
    Bindings: { NODE_ENV: string };
    Variables: { locale: string };
  }>,
) => {
  const { t, i18n } = await getTranslation({
    locale: c?.var.locale,
    request: c?.req.raw,
  });

  const status = getStatusCode(e);
  const details = {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  };

  const timestamp = new Date().toISOString();
  const path = c?.req.raw.url ? new URL(c.req.raw.url).pathname : "/api";

  if (status >= HttpStatusCode.INTERNAL_SERVER_ERROR) {
    captureException(e, { path, status, timestamp });
  }

  if (isError(e)) {
    logger.error(e.code, e.message);
    return new Response(
      JSON.stringify({
        code: e.code,
        message: e.message
          ? e.message
          : e.code && isKey(e.code, i18n)
            ? t(e.code)
            : ((e.message || e.code) ?? t("common:error.general")),
        status,
        timestamp,
        path,
      }),
      details,
    );
  }

  logger.error(e);
  return new Response(
    JSON.stringify({
      code: "common:error.general",
      message: t("common:error.general"),
      status,
      path,
    }),
    details,
  );
};
