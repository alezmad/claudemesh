import { Icons } from "@turbostarter/ui-web/icons";

import { pathsConfig } from "~/config/paths";

/**
 * Main application navigation items for the sidebar.
 * Each app has a title (i18n key), href, and icon.
 */
export const APPS = [
  {
    title: "chat",
    href: pathsConfig.apps.chat.index,
    icon: Icons.MessagesSquare,
  },
  {
    title: "image",
    href: pathsConfig.apps.image.index,
    icon: Icons.Image,
  },
  {
    title: "tts",
    href: pathsConfig.apps.tts,
    icon: Icons.AudioLines,
  },
  {
    title: "pdf",
    href: pathsConfig.apps.pdf.index,
    icon: Icons.FileText,
  },
  {
    title: "agent",
    href: pathsConfig.apps.agent,
    icon: Icons.Sparkles,
  },
] as const;
