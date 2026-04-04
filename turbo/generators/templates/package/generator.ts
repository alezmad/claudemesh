import { execSync } from "node:child_process";
import type { PlopTypes } from "@turbo/gen";

export function createPackageGenerator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("package", {
    description: "Generate a new package within monorepo",
    prompts: [
      {
        type: "input",
        name: "name",
        message:
          "What is the name of the package? (You can skip the `@turbostarter/` prefix): ",
      },
      {
        type: "input",
        name: "deps",
        message:
          "Enter a space separated list of dependencies you would like to install: ",
      },
    ],
    actions: [
      (answers) => {
        if ("name" in answers && typeof answers.name === "string") {
          if (answers.name.startsWith("@turbostarter/")) {
            answers.name = answers.name.replace("@turbostarter/", "");
          }
        }
        return "Config sanitized";
      },
      {
        type: "add",
        path: "packages/{{ name }}/eslint.config.js",
        templateFile: "templates/package/eslint.config.js.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/package.json",
        templateFile: "templates/package/package.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/tsconfig.json",
        templateFile: "templates/package/tsconfig.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/vitest.config.ts",
        templateFile: "templates/package/vitest.config.ts.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/src/index.ts",
        template: "export const name = '{{ name }}';",
      },
      {
        type: "modify",
        path: "packages/{{ name }}/package.json",
        async transform(content, answers) {
          const pkg = JSON.parse(content);

          for (const dep of answers.deps.split(" ").filter(Boolean)) {
            const version = await fetch(
              `https://registry.npmjs.org/-/package/${dep}/dist-tags`,
            )
              .then((res) => res.json())
              .then((json) => json.latest);

            if (!pkg.dependencies) pkg.dependencies = {};
            pkg.dependencies[dep] = `^${version}`;
          }
          return JSON.stringify(pkg, null, 2);
        },
      },
      async (answers) => {
        /**
         * Install dependencies and format everything
         */
        execSync(
          "pnpm dlx sherif@latest -r packages-without-package-json --fix",
          {
            stdio: "inherit",
          },
        );
        execSync("pnpm i", { stdio: "inherit" });
        execSync(`pnpm run format:fix`);
        return "Package scaffolded";
      },
    ],
  });
}
