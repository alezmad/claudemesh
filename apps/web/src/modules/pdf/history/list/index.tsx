"use client";

import { useQuery } from "@tanstack/react-query";

import { useTranslation } from "@turbostarter/i18n";
import { useDateGroups } from "@turbostarter/shared/hooks";
import { CommandGroup } from "@turbostarter/ui-web/command";
import { Skeleton } from "@turbostarter/ui-web/skeleton";

import { authClient } from "~/lib/auth/client";

import { pdf } from "../../lib/api";

import { ChatHistoryListItem } from "./item";

interface ChatHistoryListProps {
  onSelect: () => void;
}

export const ChatHistoryList = ({ onSelect }: ChatHistoryListProps) => {
  const { t } = useTranslation("common");
  const { data: session } = authClient.useSession();
  const userChats = useQuery(
    pdf.queries.chats.user.getAll(session?.user.id ?? ""),
  );

  const groups = useDateGroups(userChats.data ?? []);

  if (userChats.isLoading) {
    return (
      <CommandGroup heading={t("history")} className="w-full">
        <Skeleton className="mb-2 h-11 w-3/4 rounded-xl" />
        <Skeleton className="mb-2 h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-1/2 rounded-xl" />
      </CommandGroup>
    );
  }

  return (
    <>
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <CommandGroup heading={group.label} key={group.label}>
              {group.items.map((chat) => (
                <ChatHistoryListItem
                  key={chat.id}
                  chat={chat}
                  onSelect={onSelect}
                />
              ))}
            </CommandGroup>
          ),
      )}
    </>
  );
};
