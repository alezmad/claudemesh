import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";

export const queries = {
  get: (params: { id: string }) => ({
    queryKey: ["credits", params.id],
    queryFn: () => handle(api.ai.credits.$get)(),
  }),
};

export const mutations = {};

export const credits = {
  queries,
  mutations,
} as const;
