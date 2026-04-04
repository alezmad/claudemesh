"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { useTranslation } from "@turbostarter/i18n";
import { Badge } from "@turbostarter/ui-web/badge";
import { Button } from "@turbostarter/ui-web/button";
import { CommandItem } from "@turbostarter/ui-web/command";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { pathsConfig } from "~/config/paths";
import { authClient } from "~/lib/auth/client";
import { TurboLink } from "~/modules/common/turbo-link";
import { pdf } from "~/modules/pdf/lib/api";

import type { Chat } from "@turbostarter/ai/chat/types";

interface ChatHistoryListItemProps {
  readonly chat: Chat;
  readonly onSelect: () => void;
}

export const ChatHistoryListItem = ({
  chat,
  onSelect,
}: ChatHistoryListItemProps) => {
  const { t } = useTranslation("common");

  const router = useRouter();
  const pathname = usePathname();

  return (
    <CommandItem
      key={chat.id}
      value={`${chat.id}-${chat.name}`}
      asChild
      onSelect={() => {
        router.push(pathsConfig.apps.pdf.chat(chat.id));
        onSelect();
      }}
      className="group"
    >
      <div>
        <TurboLink
          href={pathsConfig.apps.pdf.chat(chat.id)}
          onClick={onSelect}
          className="flex min-w-0 grow items-center justify-start gap-3"
        >
          <Icons.MessagesSquare />
          <span className="truncate">{chat.name}</span>
          {pathname.includes(chat.id) && (
            <Badge variant="outline">{t("current")}</Badge>
          )}
        </TurboLink>
        <Controls chat={chat} />
      </div>
    </CommandItem>
  );
};

const Controls = ({ chat }: { chat: Chat }) => {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "";
  const { t } = useTranslation("common");

  const router = useRouter();
  const pathname = usePathname();

  const queryClient = useQueryClient();
  const { mutate } = useMutation({
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
        (old: Chat[]) => old.filter((chat) => chat.id !== data.id),
      );

      if (pathname.includes(chat.id)) {
        router.push(pathsConfig.apps.pdf.index);
      }

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
      await queryClient.invalidateQueries(
        pdf.queries.chats.user.getAll(userId),
      );
    },
  });

  return (
    <>
      <span className="text-muted-foreground ml-auto whitespace-nowrap group-data-[selected=true]:hidden">
        {dayjs(chat.createdAt).fromNow()}
      </span>

      <div className="-my-2 ml-auto hidden items-center gap-2 group-data-[selected=true]:flex">
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted-foreground/10 size-7 rounded-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(pathsConfig.apps.pdf.chat(chat.id), "_blank");
                }}
              >
                <Icons.ExternalLink className="text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("newTab")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted-foreground/10 size-7 rounded-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  mutate({ id: chat.id });
                }}
              >
                <Icons.Trash className="text-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("delete")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
};
