import type { TranslationKey } from "@turbostarter/i18n";
import type { Icon } from "@turbostarter/ui-web/icons";

export type NavigationLink =
  | {
      readonly label: TranslationKey;
      readonly href: string;
    }
  | {
      readonly label: TranslationKey;
      readonly items: NavigationLinkItem[] | readonly NavigationLinkItem[];
    };

export interface NavigationLinkItem {
  readonly title: TranslationKey;
  readonly description: TranslationKey;
  readonly href: string;
  readonly icon: Icon;
}

export interface NavigationProps {
  readonly links: NavigationLink[] | readonly NavigationLink[];
}
