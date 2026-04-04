import * as z from "zod";

import { chatSchema } from "@turbostarter/ai/pdf/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";

import type { InferRequestType } from "hono/client";

const KEY = "pdf";

const queries = {
  chats: {
    user: {
      getAll: (userId: string) => ({
        queryKey: [KEY, "chats", userId],
        queryFn: handle(api.ai.pdf.chats.$get, {
          schema: z.array(chatSchema),
        }),
      }),
    },
    documents: {
      getAll: (id: string) => ({
        queryKey: [KEY, "chats", id, "documents"],
        queryFn: () =>
          handle(api.ai.pdf.chats[":id"].documents.$get)({
            param: { id },
          }),
      }),
      getUrl: (path: string) => ({
        queryKey: [KEY, "documents", "url", path],
        queryFn: () =>
          handle(api.storage.signed.$get)({
            query: { path },
          }),
      }),
      getStatus: (documentId: string) => ({
        queryKey: [KEY, "documents", documentId, "status"],
        queryFn: async () => {
          const response = await api.ai.pdf.documents[":id"].status.$get({
            param: { id: documentId },
          });
          return response.json();
        },
      }),
    },
  },
};

const mutations = {
  chats: {
    create: {
      mutationKey: [KEY, "chats", "create"],
      mutationFn: (data: InferRequestType<typeof api.ai.pdf.chats.$post>) =>
        handle(api.ai.pdf.chats.$post)(data),
    },
    delete: {
      mutationKey: [KEY, "chats", "delete"],
      mutationFn: ({ id }: { id: string }) =>
        handle(api.ai.pdf.chats[":id"].$delete)({
          param: { id },
        }),
    },
  },
};

export const pdf = {
  queries,
  mutations,
} as const;
