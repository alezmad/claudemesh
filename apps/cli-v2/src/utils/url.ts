export function isInviteUrl(input: string): boolean {
  return (
    /^https?:\/\/[^/]+\/(?:[a-z]{2}\/)?i\//.test(input) ||
    /^https?:\/\/[^/]+\/(?:[a-z]{2}\/)?join\//.test(input) ||
    /^ic:\/\//.test(input) ||
    /^claudemesh:\/\//.test(input)
  );
}

/**
 * Normalise any accepted invite input to the canonical HTTPS short URL
 * (`https://claudemesh.com/i/<code>`) or long URL, so downstream parsers
 * only have to handle one scheme.
 */
export function normaliseInviteUrl(input: string, host = "claudemesh.com"): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("claudemesh://")) {
    const rest = trimmed.slice("claudemesh://".length).replace(/^\/+/, "");
    const m = rest.match(/^(?:i|join)\/(.+)$/);
    const tail = m ? m[1]! : rest;
    const kind = rest.startsWith("join/") ? "join" : "i";
    return `https://${host}/${kind}/${tail}`;
  }
  return trimmed;
}

export function extractInviteCode(url: string): string | null {
  const match = url.match(/\/i\/([A-Za-z0-9]+)/) || url.match(/^ic:\/\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}
