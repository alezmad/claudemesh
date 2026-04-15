import { hostname, platform, arch, release } from "node:os";

export interface DeviceInfo {
  hostname: string;
  platform: string;
  arch: string;
  osRelease: string;
  nodeVersion: string;
}

export function getDeviceInfo(): DeviceInfo {
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    nodeVersion: process.version,
  };
}
