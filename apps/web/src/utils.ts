/**
 * Attempts to share content using the Web Share API, falls back to download if unavailable.
 *
 * @param data - Either a URL-based share (with optional filename) or a Blob-based share (requires filename)
 *
 * @example
 * // Share/download a URL
 * await shareOrDownload({ url: 'https://example.com/file.pdf', filename: 'report.pdf' });
 *
 * @example
 * // Share/download a Blob
 * const blob = new Blob(['Hello'], { type: 'text/plain' });
 * await shareOrDownload({ blob, filename: 'hello.txt' });
 */
export async function shareOrDownload(
  data: { url: string; filename?: string } | { blob: Blob; filename: string }
): Promise<void> {
  if ("url" in data) {
    // URL-based sharing/download
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (navigator.share) {
      try {
        await navigator.share({ url: data.url });
        return;
      } catch {
        // Fall through to download
      }
    }
    // Download fallback
    const link = document.createElement("a");
    link.href = data.url;
    link.download = data.filename ?? "download";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // Blob-based sharing/download
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      navigator.share &&
      navigator.canShare({ files: [new File([data.blob], data.filename)] })
    ) {
      try {
        await navigator.share({
          files: [
            new File([data.blob], data.filename, { type: data.blob.type }),
          ],
        });
        return;
      } catch {
        // Fall through to download
      }
    }
    // Download fallback
    const url = URL.createObjectURL(data.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = data.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Wraps an async function to handle form submissions, preventing default and propagation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function onPromise<T extends (...args: any[]) => Promise<unknown>>(
  handler: T
): (...args: Parameters<T>) => void {
  return (...args) => {
    const event = args[0] as { preventDefault?: () => void; stopPropagation?: () => void } | undefined;
    if (event?.preventDefault) {
      event.preventDefault();
      event.stopPropagation?.();
    }
    void handler(...args);
  };
}

/**
 * Upload a file with retry logic
 * Overloaded to support both direct upload function and storage path-based upload
 */
export async function uploadWithRetry(
  fileOrOptions: File | { path: string; file: File },
  uploadFn?: (file: File) => Promise<string>,
  options?: { maxRetries?: number; delayMs?: number }
): Promise<string> {
  const { maxRetries = 3, delayMs = 1000 } = options ?? {};
  let lastError: Error | undefined;

  // Handle object-style call (path + file) - upload using fetch to presigned URL
  if (typeof fileOrOptions === "object" && "path" in fileOrOptions) {
    const { path, file } = fileOrOptions;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Get presigned URL from API
        const response = await fetch("/api/storage/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, contentType: file.type }),
        });
        if (!response.ok) throw new Error("Failed to get upload URL");
        const { url, publicUrl } = (await response.json()) as {
          url: string;
          publicUrl?: string;
        };

        // Upload file to presigned URL
        const uploadResponse = await fetch(url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!uploadResponse.ok) throw new Error("Upload failed");

        return publicUrl ?? path;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
        }
      }
    }
    throw lastError ?? new Error("Upload failed after retries");
  }

  // Handle function-style call (file + uploadFn)
  const file = fileOrOptions;
  if (!uploadFn) {
    throw new Error("uploadFn is required when passing a File directly");
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await uploadFn(file);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("Upload failed after retries");
}
