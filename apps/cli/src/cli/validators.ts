/**
 * Argument validators — fail loud at the boundary, with specific reasons.
 *
 * Each validator returns a discriminated `ValidationResult` so callers can
 * branch cleanly between "shape is wrong" (INVALID_ARGS exit) vs "value
 * is well-shaped, do the lookup" (proceed). Hints (`reason`, `expected`,
 * `nearest`) drive the three-tier error message contract:
 *
 *   1. WHAT'S WRONG — the failed assertion.
 *   2. WHAT WOULD BE VALID — the canonical shape.
 *   3. CLOSEST VALID ALTERNATIVE — best-effort suggestion.
 *
 * Use these instead of throwing strings or returning `null` for malformed
 * input. They make argument errors structurally distinct from "thing
 * doesn't exist" errors, which today's CLI conflates.
 */

export type ValidationResult<T = string> =
  | { ok: true; value: T }
  | { ok: false; code: string; reason: string; expected?: string };

const HEX_RE = /^[0-9a-f]+$/i;
const BASE62_RE = /^[A-Za-z0-9]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 64-char lowercase hex peer pubkey (member or session).
 * Accepts UPPERCASE hex and normalizes to lowercase.
 */
export function validatePubkey(input: string | undefined): ValidationResult {
  if (!input) {
    return {
      ok: false,
      code: "missing",
      reason: "pubkey is required",
      expected: "64 lowercase hex chars",
    };
  }
  if (input.length !== 64) {
    return {
      ok: false,
      code: "wrong_length",
      reason: `pubkey is ${input.length} chars, expected 64`,
      expected: "64 lowercase hex chars (try `claudemesh peer list --json`)",
    };
  }
  if (!HEX_RE.test(input)) {
    return {
      ok: false,
      code: "non_hex",
      reason: "pubkey contains non-hex characters",
      expected: "characters [0-9a-f] only",
    };
  }
  return { ok: true, value: input.toLowerCase() };
}

/**
 * Hex pubkey *prefix* — used for short-form references. Min 8 chars
 * to keep collisions vanishingly rare on a per-mesh roster, max 64.
 */
export function validatePubkeyPrefix(
  input: string | undefined,
  { min = 8 }: { min?: number } = {},
): ValidationResult {
  if (!input) {
    return {
      ok: false,
      code: "missing",
      reason: "pubkey prefix is required",
      expected: `${min}-64 lowercase hex chars`,
    };
  }
  if (input.length < min) {
    return {
      ok: false,
      code: "too_short",
      reason: `prefix is ${input.length} chars, needs ≥${min}`,
      expected: `${min}+ hex chars (full pubkey is 64)`,
    };
  }
  if (input.length > 64) {
    return {
      ok: false,
      code: "too_long",
      reason: `prefix is ${input.length} chars, max 64`,
      expected: "drop trailing characters",
    };
  }
  if (!HEX_RE.test(input)) {
    return {
      ok: false,
      code: "non_hex",
      reason: "prefix contains non-hex characters",
      expected: "characters [0-9a-f] only",
    };
  }
  return { ok: true, value: input.toLowerCase() };
}

/**
 * Message id — base62, 32 chars exact, OR a prefix of ≥8 chars.
 * Returns `{ value, isPrefix }` so callers can decide whether to
 * resolve via lookup or treat as full id.
 */
export function validateMessageId(
  input: string | undefined,
): ValidationResult<{ value: string; isPrefix: boolean }> {
  if (!input) {
    return {
      ok: false,
      code: "missing",
      reason: "message id is required",
      expected: "32-char base62 id, or ≥8-char prefix",
    };
  }
  if (input.length < 8) {
    return {
      ok: false,
      code: "too_short",
      reason: `id is ${input.length} chars, needs ≥8`,
      expected: "8+ chars (paste from a previous send/post output)",
    };
  }
  if (input.length > 32) {
    return {
      ok: false,
      code: "too_long",
      reason: `id is ${input.length} chars, max 32`,
      expected: "trim trailing characters",
    };
  }
  if (!BASE62_RE.test(input)) {
    return {
      ok: false,
      code: "bad_charset",
      reason: "id contains characters outside [A-Za-z0-9]",
      expected: "base62 only",
    };
  }
  return { ok: true, value: { value: input, isPrefix: input.length < 32 } };
}

/**
 * Mesh slug — kebab-case, lowercase, 2-64 chars.
 */
export function validateMeshSlug(input: string | undefined): ValidationResult {
  if (!input) {
    return {
      ok: false,
      code: "missing",
      reason: "mesh slug is required",
      expected: "kebab-case slug (e.g. `openclaw`)",
    };
  }
  if (input.length < 2 || input.length > 64) {
    return {
      ok: false,
      code: "wrong_length",
      reason: `slug is ${input.length} chars, expected 2-64`,
      expected: "lowercase kebab-case",
    };
  }
  if (!SLUG_RE.test(input)) {
    return {
      ok: false,
      code: "bad_format",
      reason: "slug must be lowercase letters, digits, and hyphens (no leading/trailing hyphen)",
      expected: "e.g. `team-alpha`, `flexicar-2`",
    };
  }
  return { ok: true, value: input };
}

/**
 * Render a structured validation error to stderr in the canonical
 * three-line shape: `✘ <verb> <input>` / `   <reason>` / `   <expected>`.
 *
 * Optional fourth line for `nearest` when a fuzzy suggestion is available.
 */
export function renderValidationError(
  args: {
    verb: string;
    input: string;
    result: Extract<ValidationResult, { ok: false }>;
    nearest?: string;
  },
  write: (s: string) => void = (s) => process.stderr.write(s),
): void {
  write(`  \x1b[31m✘\x1b[0m ${args.verb} ${args.input}\n`);
  write(`     ${args.result.reason}.\n`);
  if (args.result.expected) {
    write(`     expected: ${args.result.expected}\n`);
  }
  if (args.nearest) {
    write(`     did you mean: \x1b[36m${args.nearest}\x1b[0m\n`);
  }
}
