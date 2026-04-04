import { handle } from "@turbostarter/api/utils";
import { logger } from "@turbostarter/shared/logger";


import { api } from "~/lib/api/client";

import type { SyntheticEvent } from "react";

export function onPromise<T>(promise: (event: SyntheticEvent) => Promise<T>) {
  return (event: SyntheticEvent) => {
    promise(event).catch((error) => {
      logger.error("Unexpected error", error);
    });
  };
}

interface UploadParams {
  path: string;
  file: File;
  maxRetries?: number;
}

/**
 * Uploads a file to storage with retry logic
 */
export async function uploadWithRetry({
  path,
  file,
  maxRetries = 3,
}: UploadParams): Promise<{ path: string }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { url: uploadUrl } = await handle(api.storage.upload.$get)({
        query: { path },
      });

      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      return { path };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        `Upload attempt ${attempt + 1}/${maxRetries} failed:`,
        lastError.message,
      );

      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000),
        );
      }
    }
  }

  throw lastError ?? new Error("Upload failed after all retries");
}
