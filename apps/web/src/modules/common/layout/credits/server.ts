import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/server";
import { getQueryClient } from "~/lib/query/server";

import { credits } from "./api";

export const prefetchCredits = async (id: string) => {
  const queryClient = getQueryClient();

  await queryClient.prefetchQuery({
    ...credits.queries.get({ id }),
    queryFn: handle(api.ai.credits.$get),
  });

  return queryClient;
};
