import type { PlopTypes } from "@turbo/gen";

import { createPackageGenerator } from "./templates/package/generator";

const generators = [createPackageGenerator];

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  generators.forEach((gen) => gen(plop));
}
