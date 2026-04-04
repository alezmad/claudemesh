// AI credits were backed by the removed @turbostarter/ai package.
// claudemesh does not meter AI credits, so this stubs the query to return null.
export const queries = {
  get: (params: { id: string }) => ({
    queryKey: ["credits", params.id],
    queryFn: () => Promise.resolve(null as number | null),
  }),
};

export const mutations = {};

export const credits = {
  queries,
  mutations,
} as const;
