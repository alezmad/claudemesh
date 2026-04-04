"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { toast } from "sonner";

import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import { Skeleton } from "@turbostarter/ui-web/skeleton";

import { pathsConfig } from "~/config/paths";
import { authClient } from "~/lib/auth/client";
import { TurboLink } from "~/modules/common/turbo-link";

import { pdf } from "../lib/api";

import type { Chat } from "@turbostarter/ai/chat/types";

dayjs.extend(relativeTime);

const ChatCard = ({ chat }: { chat: Chat }) => {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "";
  const queryClient = useQueryClient();

  const { mutate: deleteChat, isPending } = useMutation({
    ...pdf.mutations.chats.delete,
    onMutate: async (data) => {
      await queryClient.cancelQueries({
        queryKey: pdf.queries.chats.user.getAll(userId).queryKey,
      });
      const previousChats = queryClient.getQueryData(
        pdf.queries.chats.user.getAll(userId).queryKey,
      );
      queryClient.setQueryData(
        pdf.queries.chats.user.getAll(userId).queryKey,
        (old: Chat[]) => old.filter((c) => c.id !== data.id),
      );
      return { previousChats };
    },
    onError: (error, _, context) => {
      toast.error(error.message);
      queryClient.setQueryData(
        pdf.queries.chats.user.getAll(userId).queryKey,
        context?.previousChats,
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries(pdf.queries.chats.user.getAll(userId));
    },
  });

  return (
    <div className="group bg-card hover:bg-accent/50 relative flex flex-col gap-2 rounded-lg border p-4 transition-colors">
      <TurboLink
        href={pathsConfig.apps.pdf.chat(chat.id)}
        className="absolute inset-0 z-0"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icons.FileText className="size-5" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="relative z-10 size-8 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.preventDefault();
            deleteChat({ id: chat.id });
          }}
          disabled={isPending}
        >
          <Icons.Trash className="text-muted-foreground hover:text-destructive size-4" />
        </Button>
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{chat.name}</p>
        <p className="text-muted-foreground text-sm">
          {dayjs(chat.createdAt).fromNow()}
        </p>
      </div>
    </div>
  );
};

export const RecentChats = () => {
  const { t } = useTranslation("ai");
  const { data: session } = authClient.useSession();
  const userChats = useQuery({
    ...pdf.queries.chats.user.getAll(session?.user.id ?? ""),
    enabled: !!session?.user.id,
  });

  if (!session?.user.id) {
    return null;
  }

  if (userChats.isLoading) {
    return (
      <div className="mt-8 w-full max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Icons.ClockFading className="text-muted-foreground size-4" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    );
  }

  const recentChats = userChats.data?.slice(0, 6) ?? [];

  if (recentChats.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 w-full max-w-2xl">
      <div className="text-muted-foreground mb-4 flex items-center gap-2 text-sm font-medium">
        <Icons.ClockFading className="size-4" />
        <span>{t("pdf.recent")}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {recentChats.map((chat) => (
          <ChatCard key={chat.id} chat={chat} />
        ))}
      </div>
    </div>
  );
};
