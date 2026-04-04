import { toast } from "sonner";

import { isAPIError } from "@turbostarter/api/utils";
import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { buttonVariants } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

const InsufficientCredits = () => {
  const { t } = useTranslation("common");

  const list = [
    t("credits.description", { count: 5 }),
    t("credits.description2"),
    t("credits.description3"),
  ];

  return (
    <div className="flex gap-2">
      <Icons.BanknoteX className="size-5" />
      <div className="flex flex-col gap-6">
        <span className="leading-tight font-medium">
          {t("error.insufficientCredits")}
        </span>

        <ul className="flex flex-col gap-2">
          {list.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <div className="bg-success size-2 rounded-full"></div>
              <span className="leading-tight">{item}</span>
            </li>
          ))}
        </ul>

        <a
          href="https://turbostarter.dev/ai#pricing"
          target="_blank"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "group/button gap-2",
          )}
        >
          {t("credits.cta")}{" "}
          <Icons.ArrowRight className="size-4 transition-all group-hover/button:translate-x-1" />
        </a>
      </div>
    </div>
  );
};

const RateLimit = () => {
  const { t } = useTranslation("common");

  const list = [
    t("rateLimit.description"),
    t("rateLimit.description2"),
    t("rateLimit.description3"),
  ];

  return (
    <div className="flex gap-2">
      <Icons.ClockAlert className="size-5" />
      <div className="flex flex-col gap-6">
        <span className="leading-tight font-medium">
          {t("error.rateLimit")}
        </span>

        <ul className="flex flex-col gap-2">
          {list.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <div className="bg-success size-2 rounded-full"></div>
              <span className="leading-tight">{item}</span>
            </li>
          ))}
        </ul>

        <a
          href="https://turbostarter.dev/ai#pricing"
          target="_blank"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "group/button gap-2",
          )}
        >
          {t("rateLimit.cta")}{" "}
          <Icons.ArrowRight className="size-4 transition-all group-hover/button:translate-x-1" />
        </a>
      </div>
    </div>
  );
};

const parseError = (error: Error) => {
  try {
    const parsed = JSON.parse(error.message);
    return parsed;
  } catch {
    return error.message;
  }
};

export const useAIError = () => {
  const { t } = useTranslation("common");

  const onError = (error: Error) => {
    console.error(error);
    const parsed = parseError(error);

    if (!isAPIError(parsed)) {
      return toast.error(error.message || t("error.general"));
    }

    if (parsed.code === "error.insufficientCredits") {
      return toast(<InsufficientCredits />);
    }

    if (parsed.code === "error.rateLimit") {
      return toast(<RateLimit />);
    }
  };

  return { onError };
};
