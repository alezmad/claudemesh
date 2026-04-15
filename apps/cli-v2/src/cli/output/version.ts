import { VERSION } from "~/constants/urls.js";
import { boldOrange } from "~/ui/styles.js";
export function renderVersion(): string { return "  " + boldOrange("claudemesh") + " v" + VERSION; }
