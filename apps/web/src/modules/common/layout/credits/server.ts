import { getQueryClient } from "~/lib/query/server";

import { credits } from "./api";

export const prefetchCredits = async (id: string) => {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(credits.queries.get({ id }));
  return queryClient;
};
