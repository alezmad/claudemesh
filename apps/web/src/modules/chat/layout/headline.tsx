import { useTranslation } from "@turbostarter/i18n";
import { getGreeting } from "@turbostarter/shared/utils";

export const Headline = () => {
  const { t } = useTranslation(["common", "ai"]);
  const { text, emoji } = getGreeting();

  return (
    <h1 className="leading-tighter flex w-full flex-col items-center justify-center text-center text-2xl tracking-tight @sm:text-3xl @md:text-4xl">
      {t(`greeting.${text}`)} {emoji}
      <span className="text-muted-foreground">{t("ai:chat.headline")}</span>
    </h1>
  );
};
