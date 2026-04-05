import { useQuery } from "@tanstack/react-query";

import { authClient } from "~/lib/auth/client";
import { billing } from "~/modules/billing/lib/api";

/**
 * Fetches the current user's billing customer. Gated on session
 * presence so unauthenticated public pages (landing, /pricing) don't
 * fire a 401 just to render plan cards.
 */
export const useCustomer = () => {
  const { data: session } = authClient.useSession();
  return useQuery({
    ...billing.queries.customer.get,
    enabled: !!session?.user,
  });
};
