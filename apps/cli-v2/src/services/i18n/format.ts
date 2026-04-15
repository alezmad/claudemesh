import { en } from "~/locales/en.js";

type StringKey = keyof typeof en;

export function t(key: StringKey, vars?: Record<string, string>): string {
  let str: string = en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return str;
}
