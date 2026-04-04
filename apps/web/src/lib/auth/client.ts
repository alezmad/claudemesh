import { createClient } from "@turbostarter/auth/client/web";

export const authClient = createClient({
  fetchOptions: {
    headers: {
      "x-client-platform": "web-client",
    },
    throw: true,
  },
});
