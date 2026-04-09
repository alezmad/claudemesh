/**
 * Cross-platform browser opener.
 * Respects BROWSER env var. Falls back to platform-specific launcher.
 */

import { exec } from "node:child_process";

/**
 * Open a URL in the user's default browser.
 * Returns true if the command succeeded, false otherwise.
 * Non-fatal — callers should show the URL as fallback.
 */
export function openBrowser(url: string): Promise<boolean> {
  // Validate URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return Promise.resolve(false);
  }

  const quoted = JSON.stringify(url);
  const browserCmd = process.env.BROWSER;

  const cmd = browserCmd
    ? `${browserCmd} ${quoted}`
    : process.platform === "darwin"
      ? `open ${quoted}`
      : process.platform === "win32"
        ? `rundll32 url.dll,FileProtocolHandler ${quoted}`
        : `xdg-open ${quoted}`;

  return new Promise((resolve) => {
    exec(cmd, (err) => resolve(!err));
  });
}
