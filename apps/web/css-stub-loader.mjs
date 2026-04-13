// Node.js ESM loader that stubs non-JS asset imports during Next.js page data collection.
// Payload CMS and its deps import .css/.scss/.svg files that Node.js can't handle.
const STUB_EXTENSIONS = ['.css', '.scss', '.sass', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot'];

export function resolve(specifier, context, nextResolve) {
  if (STUB_EXTENSIONS.some(ext => specifier.endsWith(ext))) {
    return { url: 'data:text/javascript,export default ""', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
