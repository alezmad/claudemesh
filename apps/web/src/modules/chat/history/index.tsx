"use client";

import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import { useState, useEffect } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@turbostarter/ui-web/command";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { ChatActions } from "./actions";
import { ChatHistoryList } from "./list";

dayjs.extend(duration);
dayjs.extend(relativeTime);

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CommandMenu = ({ open, onOpenChange }: CommandMenuProps) => {
  const { t } = useTranslation("ai");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      showCloseButton={false}
    >
      <CommandInput placeholder={t("chat.command.search")} />
      <CommandList className="h-[420px]">
        <CommandEmpty className="py-10">{t("chat.command.empty")}</CommandEmpty>
        <ChatActions onSelect={() => onOpenChange(false)} />
        <ChatHistoryList onSelect={() => onOpenChange(false)} />
      </CommandList>
    </CommandDialog>
  );
};

export const ChatHistory = () => {
  const { t } = useTranslation("common");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
      <TooltipProvider>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="group relative"
              onClick={() => setIsOpen(true)}
            >
              <Icons.TextSearch className="text-muted-foreground group-hover:text-foreground size-5" />
              <span className="sr-only">{t("history")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>{t("history")}</span>
            <kbd className="text-muted-foreground pointer-events-none inline-flex items-center gap-0.5 pl-1 font-mono select-none">
              {/* eslint-disable-next-line i18next/no-literal-string */}
              <span className="">⌘</span>K
            </kbd>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <CommandMenu open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
};
