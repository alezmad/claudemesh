import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
const STUB_EXT = ['.css', '.scss', '.sass', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
export function resolve(specifier, context, nextResolve) {
  if (STUB_EXT.some(ext => specifier.endsWith(ext))) {
    return { url: 'data:text/javascript,export default ""', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`));
