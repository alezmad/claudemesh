import * as auth from "./auth";
import * as chat from "./chat";
import * as creditTransactions from "./credit-transaction";
import * as customers from "./customer";
import * as image from "./image";
import * as mesh from "./mesh";
import * as pdf from "./pdf";

type Prefix<
  T extends Record<string, unknown>,
  K extends keyof T,
  P extends string,
> = {
  [Key in K as `${P}.${Key & string}`]: T[Key];
};

export const prefix = <T extends Record<string, unknown>, P extends string>(
  obj: T,
  prefix: P,
) => {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => ({ ...acc, [`${prefix}.${key}`]: value }),
    {} as Prefix<T, keyof T, P>,
  );
};

export const schema = {
  ...auth,
  ...creditTransactions,
  ...customers,
  ...prefix(chat, "chat"),
  ...prefix(pdf, "pdf"),
  ...prefix(image, "image"),
  ...prefix(mesh, "mesh"),
};

// Direct exports for backward compatibility
export * from "./auth";
export * from "./credit-transaction";
export * from "./customer";

// pgSchema-based modules (need explicit exports for drizzle-kit)
export * from "./chat";
export * from "./pdf";
export * from "./image";
export * from "./mesh";
