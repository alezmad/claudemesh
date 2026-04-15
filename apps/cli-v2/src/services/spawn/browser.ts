import { execFile } from "node:child_process";
import { platform } from "node:os";

export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform();
    let bin: string;
    let args: string[];
    if (os === "darwin") {
      bin = "open";
      args = [url];
    } else if (os === "win32") {
      bin = "cmd";
      args = ["/c", "start", "", url];
    } else {
      bin = "xdg-open";
      args = [url];
    }

    execFile(bin, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
