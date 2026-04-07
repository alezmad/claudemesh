/**
 * `claudemesh create` — Create a new mesh with an optional template.
 * Lists available templates if --list-templates is passed.
 */
import { listTemplates, getTemplate } from "../templates/index.js";

export function runCreate(args: Record<string, unknown>): void {
  if (args["list-templates"]) {
    console.log("Available mesh templates:\n");
    for (const t of listTemplates()) {
      console.log(`  ${t.name}`);
      console.log(`    ${t.description}`);
      console.log(`    Groups: ${t.groups.map((g) => g.name).join(", ") || "(none)"}`);
      console.log(`    State keys: ${Object.keys(t.stateKeys).join(", ") || "(none)"}`);
      console.log();
    }
    return;
  }

  const templateName = args.template as string | undefined;
  if (templateName) {
    const template = getTemplate(templateName);
    if (!template) {
      console.error(`Unknown template "${templateName}". Use --list-templates to see available options.`);
      process.exit(1);
    }
    console.log(`Template "${template.name}" loaded:`);
    console.log(`  Groups: ${template.groups.map((g) => `@${g.name}`).join(", ")}`);
    console.log(`  State keys: ${Object.keys(template.stateKeys).join(", ")}`);
    console.log(`  Hint: ${template.systemPromptHint.slice(0, 80)}...`);
    console.log();
    console.log("Template applied. Use `claudemesh launch` with --groups to join the predefined groups.");
    // Future: wire into actual mesh creation API
    return;
  }

  console.log("Usage: claudemesh create --template <name>");
  console.log("       claudemesh create --list-templates");
}
