import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { messageSchema, partSchema } from "@turbostarter/ai/chat/schema";
import { toChatMessage } from "@turbostarter/ai/chat/utils";
import { handle } from "@turbostarter/api/utils";

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/server";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { ViewChat } from "~/modules/chat/layout/view";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) => {
  const id = (await params).id;
  const data = await handle(api.ai.chat.chats[":id"].$get, { throwOnError: false })({
    param: { id },
  });

  return getMetadata({
    ...(data?.name && { title: data.name }),
  })({ params });
};

export default async function Chat({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await getSession();

  if (!user) {
    return redirect(pathsConfig.auth.login);
  }

  const id = (await params).id;

  const data = await handle(api.ai.chat.chats[":id"].$get, { throwOnError: false })({
    param: { id },
  });

  if (!data) {
    return notFound();
  }

  const messages = await handle(api.ai.chat.chats[":id"].messages.$get, {
    throwOnError: false,
    schema: z.array(
      messageSchema.extend({
        parts: z.array(partSchema),
      }),
    ),
  })({
    param: { id },
  });
  const initialMessages = (messages ?? []).map(toChatMessage);

  return <ViewChat id={id} initialMessages={initialMessages} />;
}
