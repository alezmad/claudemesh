export function isInviteUrl(input: string): boolean {
  return /^https?:\/\/claudemesh\.com\/i\//.test(input) || /^ic:\/\//.test(input);
}

export function extractInviteCode(url: string): string | null {
  const m = url.match(/\/i\/([A-Za-z0-9]+)/) || url.match(/^ic:\/\/([A-Za-z0-9]+)/);
  return m?.[1] ?? null;
}
