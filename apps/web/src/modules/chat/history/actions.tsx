import { useTranslation } from "@turbostarter/i18n";
import { CommandGroup, CommandItem } from "@turbostarter/ui-web/command";
import { Icons } from "@turbostarter/ui-web/icons";

import { pathsConfig } from "~/config/paths";
import { TurboLink } from "~/modules/common/turbo-link";

interface ChatActionsProps {
  onSelect: () => void;
}

export const ChatActions = ({ onSelect }: ChatActionsProps) => {
  const { t } = useTranslation(["common", "ai"]);

  return (
    <CommandGroup heading={t("actions")}>
      <CommandItem asChild>
        <TurboLink href={pathsConfig.apps.chat.index} onClick={onSelect}>
          <Icons.SquarePen />
          <span>{t("chat.new")}</span>
        </TurboLink>
      </CommandItem>
    </CommandGroup>
  );
};
