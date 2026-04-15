import { execSync } from "node:child_process";
import { platform } from "node:os";

export function readClipboard(): string | null {
  try {
    const os = platform();
    if (os === "darwin") return execSync("pbpaste", { encoding: "utf-8" }).trim();
    if (os === "linux") {
      try {
        return execSync("xclip -selection clipboard -o", { encoding: "utf-8" }).trim();
      } catch {
        return execSync("wl-paste --no-newline", { encoding: "utf-8" }).trim();
      }
    }
    if (os === "win32") return execSync("powershell -command Get-Clipboard", { encoding: "utf-8" }).trim();
    return null;
  } catch {
    return null;
  }
}

export function writeClipboard(text: string): boolean {
  try {
    const os = platform();
    if (os === "darwin") {
      execSync("pbcopy", { input: text });
      return true;
    }
    if (os === "linux") {
      try {
        execSync("xclip -selection clipboard", { input: text });
      } catch {
        execSync("wl-copy", { input: text });
      }
      return true;
    }
    if (os === "win32") {
      execSync("clip", { input: text });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
