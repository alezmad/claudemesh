import { useTranslation } from "@turbostarter/i18n";

export const Headline = () => {
  const { t } = useTranslation("ai");

  return (
    <h1 className="leading-tighter flex w-full flex-col items-center justify-center text-center text-2xl tracking-tight text-pretty @sm:text-3xl @md:text-4xl">
      {t("image.headline.title")}
      <span className="text-muted-foreground">
        {t("image.headline.subtitle")}
      </span>
    </h1>
  );
};
