/**
 * `claudemesh url-handler <install|uninstall>` — register a `claudemesh://`
 * URL scheme handler with the OS so click-to-launch from email/web works.
 *
 * Scheme: `claudemesh://join/<code-or-token>` or `claudemesh://i/<code>`.
 * When activated, the OS opens the handler, which runs
 *   claudemesh https://claudemesh.com/i/<code>
 * (inline join + launch path via the bare-URL dispatch in cli.ts).
 *
 * Platforms:
 *   - darwin  → LSRegisterURL via a per-user .app bundle in
 *               ~/Library/Application\ Support/claudemesh/ClaudemeshHandler.app
 *   - linux   → xdg-mime default + a .desktop file in
 *               ~/.local/share/applications/claudemesh.desktop
 *   - win32   → HKCU\Software\Classes\claudemesh (registry write)
 */

import { platform, homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { EXIT } from "~/constants/exit-codes.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";

function resolveClaudemeshBin(): string {
  // argv[1] points to the running binary; prefer that over $PATH so we
  // register the exact install the user ran.
  return process.argv[1] ?? "claudemesh";
}

function installDarwin(): number {
  const binPath = resolveClaudemeshBin();
  const appDir = join(homedir(), "Library", "Application Support", "claudemesh", "ClaudemeshHandler.app");
  const contents = join(appDir, "Contents");
  const macOS = join(contents, "MacOS");
  mkdirSync(macOS, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.claudemesh.handler</string>
  <key>CFBundleName</key><string>Claudemesh</string>
  <key>CFBundleExecutable</key><string>open-url</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleSignature</key><string>????</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Claudemesh Invite</string>
      <key>CFBundleURLSchemes</key>
      <array><string>claudemesh</string></array>
    </dict>
  </array>
</dict>
</plist>`;
  writeFileSync(join(contents, "Info.plist"), plist);

  // Tiny shell shim: parse the URL and re-invoke the CLI in a Terminal
  // window so the user sees launch output.
  const shim = `#!/bin/sh
URL="$1"
CODE=\${URL#claudemesh://}
CODE=\${CODE#i/}
CODE=\${CODE#join/}
# Open a Terminal window so the user can see claude launching
osascript <<EOF
tell application "Terminal"
  activate
  do script "${binPath.replace(/"/g, '\\"')} https://claudemesh.com/i/$CODE"
end tell
EOF
`;
  const shimPath = join(macOS, "open-url");
  writeFileSync(shimPath, shim);
  chmodSync(shimPath, 0o755);

  // Re-register with Launch Services so the scheme resolves here.
  const lsreg = spawnSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", appDir], { encoding: "utf-8" });
  if (lsreg.status !== 0) {
    render.warn("lsregister returned non-zero", "scheme may not activate until Finder rescans.");
  }
  render.ok("registered claudemesh:// scheme on macOS", dim(appDir));
  return EXIT.SUCCESS;
}

function installLinux(): number {
  const binPath = resolveClaudemeshBin();
  const appsDir = join(homedir(), ".local", "share", "applications");
  mkdirSync(appsDir, { recursive: true });
  const desktop = `[Desktop Entry]
Type=Application
Name=Claudemesh
Comment=Claudemesh invite handler
Exec=${binPath} %u
StartupNotify=false
Terminal=true
MimeType=x-scheme-handler/claudemesh;
NoDisplay=true
`;
  const desktopPath = join(appsDir, "claudemesh.desktop");
  writeFileSync(desktopPath, desktop);

  const xdg1 = spawnSync("xdg-mime", ["default", "claudemesh.desktop", "x-scheme-handler/claudemesh"], { encoding: "utf-8" });
  if (xdg1.status !== 0) {
    render.warn("xdg-mime not available — skipped mime default registration");
  }
  const xdg2 = spawnSync("update-desktop-database", [appsDir], { encoding: "utf-8" });
  xdg2.status ?? 0; // best effort
  render.ok("registered claudemesh:// scheme on Linux", dim(desktopPath));
  return EXIT.SUCCESS;
}

function installWindows(): number {
  const binPath = resolveClaudemeshBin().replace(/\//g, "\\");
  const lines = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[HKEY_CURRENT_USER\\Software\\Classes\\claudemesh]`,
    `@="URL:Claudemesh Invite"`,
    `"URL Protocol"=""`,
    ``,
    `[HKEY_CURRENT_USER\\Software\\Classes\\claudemesh\\shell\\open\\command]`,
    `@="\\"${binPath.replace(/\\/g, "\\\\")}\\" \\"%1\\""`,
  ];
  const regPath = join(homedir(), "claudemesh-handler.reg");
  writeFileSync(regPath, lines.join("\r\n"));
  const res = spawnSync("reg.exe", ["import", regPath], { encoding: "utf-8" });
  if (res.status !== 0) {
    render.warn("reg.exe import failed", `manual: double-click ${regPath}`);
    return EXIT.INTERNAL_ERROR;
  }
  render.ok("registered claudemesh:// scheme on Windows");
  return EXIT.SUCCESS;
}

function uninstallDarwin(): number {
  const appDir = join(homedir(), "Library", "Application Support", "claudemesh", "ClaudemeshHandler.app");
  if (existsSync(appDir)) rmSync(appDir, { recursive: true, force: true });
  render.ok("removed claudemesh:// handler on macOS");
  return EXIT.SUCCESS;
}

function uninstallLinux(): number {
  const desktopPath = join(homedir(), ".local", "share", "applications", "claudemesh.desktop");
  if (existsSync(desktopPath)) rmSync(desktopPath, { force: true });
  render.ok("removed claudemesh:// handler on Linux");
  return EXIT.SUCCESS;
}

function uninstallWindows(): number {
  spawnSync("reg.exe", ["delete", "HKCU\\Software\\Classes\\claudemesh", "/f"], { encoding: "utf-8" });
  render.ok("removed claudemesh:// handler on Windows");
  return EXIT.SUCCESS;
}

export async function runUrlHandler(action: string | undefined): Promise<number> {
  const act = action ?? "install";
  const p = platform();
  if (act === "install") {
    if (p === "darwin") return installDarwin();
    if (p === "linux") return installLinux();
    if (p === "win32") return installWindows();
  } else if (act === "uninstall" || act === "remove") {
    if (p === "darwin") return uninstallDarwin();
    if (p === "linux") return uninstallLinux();
    if (p === "win32") return uninstallWindows();
  } else {
    render.err("Usage: claudemesh url-handler <install|uninstall>");
    return EXIT.INVALID_ARGS;
  }
  render.err(`Unsupported platform: ${p}`);
  return EXIT.INTERNAL_ERROR;
}
