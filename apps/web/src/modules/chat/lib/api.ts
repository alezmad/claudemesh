import * as z from "zod";

import { chatSchema } from "@turbostarter/ai/chat/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/client";

const KEY = "chat";

const queries = {
  chats: {
    user: {
      getAll: (userId: string) => ({
        queryKey: [KEY, "chats", userId],
        queryFn: handle(api.ai.chat.chats.$get, {
          schema: z.array(chatSchema),
        }),
      }),
    },
  },
};

const mutations = {
  chats: {
    delete: {
      mutationKey: [KEY, "chats", "delete"],
      mutationFn: ({ id }: { id: string }) =>
        handle(api.ai.chat.chats[":id"].$delete)({
          param: { id },
        }),
    },
  },
};

export const chat = {
  queries,
  mutations,
} as const;
