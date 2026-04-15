import { URLS } from "~/constants/urls.js";
import { TIMINGS } from "~/constants/timings.js";
import { isNewer } from "~/utils/semver.js";

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMINGS.API_TIMEOUT_MS);

  try {
    const res = await fetch(URLS.NPM_REGISTRY, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return { current: currentVersion, latest: currentVersion, updateAvailable: false };

    const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
    const latest = data["dist-tags"]?.latest ?? currentVersion;

    return {
      current: currentVersion,
      latest,
      updateAvailable: isNewer(currentVersion, latest),
    };
  } catch {
    return { current: currentVersion, latest: currentVersion, updateAvailable: false };
  } finally {
    clearTimeout(timeout);
  }
}
