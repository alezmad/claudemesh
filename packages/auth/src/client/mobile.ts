import { expoClient } from "@better-auth/expo/client";
import { lastLoginMethodClient } from "@better-auth/expo/plugins";
import {
  magicLinkClient,
  twoFactorClient,
  anonymousClient,
  adminClient,
  organizationClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { AuthMobileClientOptions } from "..";
import type { auth } from "../server";
import type { AuthClientOptions } from "../types";
import type { LastLoginMethodClientConfig } from "@better-auth/expo/plugins";

export const createClient = ({
  mobile,
  lastLoginMethod,
  ...options
}: AuthClientOptions & {
  mobile: AuthMobileClientOptions;
  lastLoginMethod: LastLoginMethodClientConfig;
}) =>
  createAuthClient({
    ...options,
    plugins: [
      ...(options.plugins ?? []),
      anonymousClient(),
      magicLinkClient(),
      twoFactorClient(),
      adminClient(),
      organizationClient(),
      lastLoginMethodClient(lastLoginMethod),
      inferAdditionalFields<typeof auth>(),
      expoClient(mobile),
    ],
  });
