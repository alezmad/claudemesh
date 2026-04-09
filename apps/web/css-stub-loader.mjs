/**
 * Node.js ESM custom loader — stubs static asset imports as empty modules.
 *
 * Next.js 16 does route collection in raw Node ESM (not webpack/turbopack).
 * Payload CMS deps import .css, .scss, .svg, and other assets that Node
 * can't handle. This loader intercepts those and returns empty modules.
 *
 * Usage: NODE_OPTIONS="--import ./apps/web/css-stub-loader.mjs"
 */

import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
const STYLE_RE = /\\.(css|scss|sass|less|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|otf)$/;

export function resolve(specifier, context, nextResolve) {
  if (STYLE_RE.test(specifier)) {
    return { url: 'data:text/javascript,export default {};', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (STYLE_RE.test(url)) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }
  return nextLoad(url, context);
}
`),
  import.meta.url,
);
