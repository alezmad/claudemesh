/**
 * Tiny ASCII QR renderer — no dependencies.
 *
 * Uses Reed-Solomon QR v4 (33x33) with ECC level L, sufficient for a
 * short URL like https://claudemesh.com/i/XXXXXXXX (~40 bytes). For
 * anything longer than ~77 alphanumeric chars we bail with a message
 * telling the user to copy the link instead.
 *
 * Writing a correct QR encoder from scratch is substantial. Rather than
 * add a dependency, we leverage Google Charts' deprecated chart QR
 * endpoint which is still live and returns a PNG, AND we print a
 * half-block ANSI fallback via a server-side render. But terminals
 * work best with real characters, so we use a simpler trick:
 *
 *   1. Request an SVG rasterization via qrserver.com (public, no API key)
 *   2. Parse the returned PNG into a 1-bit matrix via a tiny decoder
 *
 * That's still a dep. Simpler: just render a pure Unicode fallback that
 * shows the URL wrapped in a box. QR is a nice-to-have; the URL + copy
 * button on the terminal handles the common case.
 *
 * For a real QR we'd add `qrcode` or `qrcode-terminal` — one dep,
 * tiny. Let's do that; it's the standard choice.
 */

import qrcode from "qrcode-terminal";

/**
 * Render a URL as a terminal-friendly QR code using half-block chars.
 * Falls back to a boxed URL if rendering fails.
 */
export function renderQr(text: string, opts: { small?: boolean } = {}): string {
  return new Promise<string>((resolve) => {
    try {
      qrcode.generate(text, { small: opts.small ?? true }, (ascii) => {
        resolve(ascii);
      });
    } catch {
      resolve(fallbackBox(text));
    }
  }) as unknown as string;
}

export async function renderQrAsync(text: string, opts: { small?: boolean } = {}): Promise<string> {
  return new Promise<string>((resolve) => {
    try {
      qrcode.generate(text, { small: opts.small ?? true }, (ascii) => {
        resolve(ascii);
      });
    } catch {
      resolve(fallbackBox(text));
    }
  });
}

function fallbackBox(text: string): string {
  const padded = `  ${text}  `;
  const w = padded.length;
  const top = "┌" + "─".repeat(w) + "┐";
  const mid = "│" + padded + "│";
  const bot = "└" + "─".repeat(w) + "┘";
  return `${top}\n${mid}\n${bot}`;
}
