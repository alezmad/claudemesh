/** No U+FFFD replacement chars, no C0/DEL controls other than tab, newline, CR.
 *  Used to refuse rendering undecryptable payloads as text (spec 2026-09-26 §1). */
export function isRenderableText(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
}

/** Strict base64 → UTF-8. Buffer#toString never throws (invalid bytes
 *  become U+FFFD), so validate with a fatal TextDecoder instead. */
export function decodeBase64Utf8(b64: string): string | null {
  try {
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length === 0) return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return isRenderableText(text) ? text : null;
  } catch {
    return null;
  }
}
