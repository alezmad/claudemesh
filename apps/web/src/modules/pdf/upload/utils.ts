import type { RemoteFile } from "@turbostarter/ai/pdf/types";

export type FileInput = File | RemoteFile;

export const getFileName = (file: FileInput) => {
  if ("name" in file) {
    return file.name.replace(/\.[^.]+$/, "");
  }

  const fileName = file.url.split("/").pop() ?? null;
  if (!fileName) return null;
  return fileName.replace(/\.[^.]+$/, "");
};

export const readFile = async (file: FileInput) => {
  if ("url" in file) {
    // Use server proxy to fetch external URLs (avoids CORS issues)
    const proxyUrl = `/api/storage/proxy?url=${encodeURIComponent(file.url)}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(error.error ?? "Failed to fetch PDF from URL");
    }

    const blob = await response.blob();
    return blob;
  } else {
    const reader = new FileReader();
    return new Promise<Blob>((resolve, reject) => {
      reader.onloadend = () =>
        resolve(new Blob([reader.result as ArrayBuffer]));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
};
