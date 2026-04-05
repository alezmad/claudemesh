import env from "env.config";

import { SocialProvider, authConfigSchema } from "@turbostarter/auth";

import type { AuthConfig } from "@turbostarter/auth";

/** Coerce env value to boolean (handles both parsed booleans and raw strings) */
const toBool = (val: unknown, fallback: boolean): boolean => {
  if (typeof val === "boolean") return val;
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  return fallback;
};

export const authConfig = authConfigSchema.parse({
  providers: {
    password: toBool(env.NEXT_PUBLIC_AUTH_PASSWORD, true),
    magicLink: toBool(env.NEXT_PUBLIC_AUTH_MAGIC_LINK, false),
    passkey: toBool(env.NEXT_PUBLIC_AUTH_PASSKEY, true),
    // claudemesh requires auth — mesh membership is tied to an account
    anonymous: toBool(env.NEXT_PUBLIC_AUTH_ANONYMOUS, false),
    // v0.1.0: GitHub + Google. Apple deferred until we need it.
    oAuth: [SocialProvider.GOOGLE, SocialProvider.GITHUB],
  },
}) satisfies AuthConfig;
