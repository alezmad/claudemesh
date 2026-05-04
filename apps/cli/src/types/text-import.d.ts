/**
 * Bun's text-import attribute lets us bake `.md` content into the bundle
 * at build time. TypeScript doesn't know about the import attribute
 * syntax for non-JS modules, so we declare the wildcard here.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
