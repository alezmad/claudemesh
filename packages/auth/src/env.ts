import { defineEnv } from "envin";
import * as z from "zod";

import { envConfig, NodeEnv } from "@turbostarter/shared/constants";

import type { Preset } from "envin/types";

export const preset = {
  id: "auth",
  server: {
    BETTER_AUTH_SECRET: z.string().optional(),

    APPLE_CLIENT_ID: z.string().optional().default(""),
    APPLE_CLIENT_SECRET: z.string().optional().default(""),
    APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional().default(""),
    GOOGLE_CLIENT_ID: z.string().optional().default(""),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
    GITHUB_CLIENT_ID: z.string().optional().default(""),
    GITHUB_CLIENT_SECRET: z.string().optional().default(""),

    FREE_TIER_CREDITS: z.coerce.number().optional().default(100),

    SEED_EMAIL: z.email().optional().default("me@turbostarter.dev"),
    SEED_PASSWORD: z.string().optional().default("Pa$$w0rd"),
  },
} as const satisfies Preset;

export const env = defineEnv({
  ...envConfig,
  ...preset,
  shared: {
    NODE_ENV: z.enum(NodeEnv).default(NodeEnv.DEVELOPMENT),
  },
});
