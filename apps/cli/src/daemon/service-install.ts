// Service-install for daemon mode (spec §9). Two platforms:
//   - macOS: ~/Library/LaunchAgents/com.claudemesh.daemon.plist (launchctl bootstrap)
//   - Linux: ~/.config/systemd/user/claudemesh-daemon.service (systemctl --user enable)
//
// Both run as the invoking user, redirect stdout/stderr to ~/.claudemesh/
// daemon/daemon.log, restart on crash, and start at login. CI envs are
// refused unless --allow-ci-persistent is passed (spec §9 / §16.3).

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import { DAEMON_PATHS } from "./paths.js";

export type ServicePlatform = "darwin" | "linux";
export interface InstallResult {
  platform: ServicePlatform;
  unitPath: string;
  /** Shell snippet that the operator can run to bring the service up now. */
  bootCommand: string;
}

const SERVICE_LABEL = "com.claudemesh.daemon";
const SYSTEMD_UNIT  = "claudemesh-daemon.service";

export function detectPlatform(): ServicePlatform | null {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux")  return "linux";
  return null;
}

function isCi(): boolean {
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI || process.env.BUILDKITE
         || process.env.CIRCLECI || process.env.JENKINS_URL);
}

export interface InstallArgs {
  /** Path to the `claudemesh` binary, e.g. /opt/homebrew/bin/claudemesh */
  binaryPath: string;
  /** Mesh slug to attach to. */
  meshSlug: string;
  /** Optional display name. */
  displayName?: string;
  /** Override the auto-detected CI refusal. */
  allowCi?: boolean;
}

export function installService(args: InstallArgs): InstallResult {
  const platform = detectPlatform();
  if (!platform) throw new Error(`unsupported platform: ${process.platform}`);
  if (isCi() && !args.allowCi) {
    throw new Error("Refusing to install persistent service in CI; pass --allow-ci-persistent to override.");
  }
  if (!existsSync(args.binaryPath)) {
    throw new Error(`binary not found at ${args.binaryPath}`);
  }
  // Make sure the daemon dir exists so the launchd/systemd log paths resolve.
  mkdirSync(DAEMON_PATHS.DAEMON_DIR, { recursive: true, mode: 0o700 });

  if (platform === "darwin") return installDarwin(args);
  return installLinux(args);
}

export function uninstallService(): { platform: ServicePlatform | null; removed: string[] } {
  const platform = detectPlatform();
  const removed: string[] = [];
  if (platform === "darwin") {
    const p = darwinPlistPath();
    try { execSync(`launchctl bootout gui/$(id -u)/${SERVICE_LABEL}`, { stdio: "ignore" }); } catch { /* not loaded */ }
    if (existsSync(p)) { unlinkSync(p); removed.push(p); }
  } else if (platform === "linux") {
    const p = linuxUnitPath();
    try { execSync(`systemctl --user disable --now ${SYSTEMD_UNIT}`, { stdio: "ignore" }); } catch { /* not loaded */ }
    if (existsSync(p)) { unlinkSync(p); removed.push(p); }
  }
  return { platform, removed };
}

// ── macOS ──────────────────────────────────────────────────────────────

function darwinPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function installDarwin(args: InstallArgs): InstallResult {
  const plist = darwinPlistPath();
  mkdirSync(dirname(plist), { recursive: true });
  const log = DAEMON_PATHS.LOG_FILE;
  const meshArgs = [
    "<string>daemon</string>",
    "<string>up</string>",
    "<string>--mesh</string>",
    `<string>${escapeXml(args.meshSlug)}</string>`,
    ...(args.displayName ? ["<string>--name</string>", `<string>${escapeXml(args.displayName)}</string>`] : []),
  ].join("\n    ");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(args.binaryPath)}</string>
    ${meshArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(log)}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(homedir())}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(homedir())}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`;
  writeFileSync(plist, xml, { mode: 0o644 });

  return {
    platform: "darwin",
    unitPath: plist,
    bootCommand: `launchctl bootstrap gui/$(id -u) ${shellQuote(plist)}`,
  };
}

// ── Linux ──────────────────────────────────────────────────────────────

function linuxUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

function installLinux(args: InstallArgs): InstallResult {
  const unit = linuxUnitPath();
  mkdirSync(dirname(unit), { recursive: true });
  const execArgs = [
    "daemon", "up",
    "--mesh", args.meshSlug,
    ...(args.displayName ? ["--name", args.displayName] : []),
  ].map(shellQuote).join(" ");

  const content = `[Unit]
Description=claudemesh daemon (peer mesh runtime)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${shellQuote(args.binaryPath)} ${execArgs}
Restart=always
RestartSec=3
StandardOutput=append:${DAEMON_PATHS.LOG_FILE}
StandardError=append:${DAEMON_PATHS.LOG_FILE}
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;
  writeFileSync(unit, content, { mode: 0o644 });

  return {
    platform: "linux",
    unitPath: unit,
    bootCommand: `systemctl --user daemon-reload && systemctl --user enable --now ${SYSTEMD_UNIT}`,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shellQuote(s: string): string {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

/** Diagnostic helper: dump current install status for `claudemesh daemon status --json`. */
export function readInstalledUnit(): { platform: ServicePlatform | null; path: string | null; content: string | null } {
  const platform = detectPlatform();
  if (!platform) return { platform: null, path: null, content: null };
  const path = platform === "darwin" ? darwinPlistPath() : linuxUnitPath();
  if (!existsSync(path)) return { platform, path: null, content: null };
  try { return { platform, path, content: readFileSync(path, "utf8") }; }
  catch { return { platform, path, content: null }; }
}
