import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";

import type { InferRequestType } from "hono/client";

const KEY = "image";

const queries = {
  images: {
    user: {
      getAll: (userId: string) => ({
        queryKey: [KEY, "images", userId],
        queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
          handle(api.ai.image.images.$get)({
            query: {
              cursor: pageParam,
            },
          }),
      }),
    },
  },
};

const mutations = {
  generations: {
    create: {
      mutationKey: [KEY, "generations", "create"],
      mutationFn: (
        json: InferRequestType<typeof api.ai.image.generations.$post>["json"],
      ) =>
        handle(api.ai.image.generations.$post)({
          json,
        }),
    },
  },
};

export const image = {
  queries,
  mutations,
} as const;
