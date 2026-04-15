import { describe, it, expect } from "vitest";
import { levenshtein } from "~/utils/levenshtein.js";
import { toSlug } from "~/utils/slug.js";
import { isInviteUrl, extractInviteCode } from "~/utils/url.js";
import { formatBytes, formatDuration } from "~/utils/format.js";
import { isNewer } from "~/utils/semver.js";

describe("levenshtein", () => {
  it("identical strings = 0", () => { expect(levenshtein("abc", "abc")).toBe(0); });
  it("empty vs non-empty", () => { expect(levenshtein("", "abc")).toBe(3); });
  it("single edit", () => { expect(levenshtein("kitten", "sitten")).toBe(1); });
  it("full transform", () => { expect(levenshtein("kitten", "sitting")).toBe(3); });
});

describe("toSlug", () => {
  it("lowercases and replaces spaces", () => { expect(toSlug("My Team")).toBe("my-team"); });
  it("strips special chars", () => { expect(toSlug("test@#$mesh")).toBe("test-mesh"); });
  it("trims dashes", () => { expect(toSlug("--hello--")).toBe("hello"); });
});

describe("isInviteUrl", () => {
  it("matches https claudemesh.com/i/", () => { expect(isInviteUrl("https://claudemesh.com/i/ABC123")).toBe(true); });
  it("matches ic:// protocol", () => { expect(isInviteUrl("ic://ABC123")).toBe(true); });
  it("rejects random URL", () => { expect(isInviteUrl("https://example.com")).toBe(false); });
});

describe("extractInviteCode", () => {
  it("extracts from /i/ URL", () => { expect(extractInviteCode("https://claudemesh.com/i/AB12CD34")).toBe("AB12CD34"); });
  it("extracts from ic:// URL", () => { expect(extractInviteCode("ic://XY99")).toBe("XY99"); });
  it("returns null for invalid", () => { expect(extractInviteCode("https://example.com")).toBeNull(); });
});

describe("formatBytes", () => {
  it("bytes", () => { expect(formatBytes(500)).toBe("500 B"); });
  it("kilobytes", () => { expect(formatBytes(2048)).toBe("2.0 KB"); });
  it("megabytes", () => { expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB"); });
});

describe("formatDuration", () => {
  it("milliseconds", () => { expect(formatDuration(500)).toBe("500ms"); });
  it("seconds", () => { expect(formatDuration(3500)).toBe("3.5s"); });
  it("minutes", () => { expect(formatDuration(125000)).toBe("2m 5s"); });
});

describe("isNewer", () => {
  it("major bump", () => { expect(isNewer("1.0.0", "2.0.0")).toBe(true); });
  it("minor bump", () => { expect(isNewer("1.0.0", "1.1.0")).toBe(true); });
  it("patch bump", () => { expect(isNewer("1.0.0", "1.0.1")).toBe(true); });
  it("same version", () => { expect(isNewer("1.0.0", "1.0.0")).toBe(false); });
  it("older version", () => { expect(isNewer("2.0.0", "1.0.0")).toBe(false); });
});
