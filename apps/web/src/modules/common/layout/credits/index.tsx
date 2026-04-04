import NumberFlow from "@number-flow/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";

import { authClient } from "~/lib/auth/client";

import { credits } from "./api";

// Local replacements — @turbostarter/ai package removed in claudemesh fork.
// claudemesh does not meter AI credits (not an AI consumption product), but
// the surrounding UI still calls these with a number.
type CreditsLevel = "high" | "medium" | "low";
const getCreditsLevel = (n: number): CreditsLevel =>
  n > 500 ? "high" : n > 100 ? "medium" : "low";
const getCreditsProgress = (n: number): number =>
  Math.max(0, Math.min(1, n / 1000));

export const useCredits = () => {
  const queryClient = useQueryClient();
  const { data } = authClient.useSession();

  const query = useQuery({
    ...credits.queries.get({ id: data?.user.id ?? "" }),
    enabled: !!data?.user.id,
  });

  const invalidate = () =>
    queryClient.invalidateQueries(
      credits.queries.get({ id: data?.user.id ?? "" }),
    );

  return {
    // eslint-disable-next-line @tanstack/query/no-rest-destructuring
    ...query,
    invalidate,
  };
};

export const Credits = () => {
  const { t } = useTranslation("common");
  const { data: credits } = useCredits();

  if (typeof credits !== "number") {
    return null;
  }

  const level = getCreditsLevel(credits);
  const progress = getCreditsProgress(credits);

  return (
    <li
      className={cn("mx-2 mt-2 flex flex-col overflow-hidden rounded-md", {
        "bg-success/10": level === "high",
        "bg-yellow-500/10": level === "medium",
        "bg-destructive/10": level === "low",
      })}
    >
      <div className="flex items-center justify-center gap-2 py-2.5">
        <div
          className={cn("size-2.5 animate-pulse rounded-full", {
            "bg-success": level === "high",
            "bg-yellow-500": level === "medium",
            "bg-destructive": level === "low",
          })}
        ></div>
        <span className={cn("text-foreground text-sm font-medium", {})}>
          <NumberFlow value={credits} format={{ style: "decimal" }} />{" "}
          {t("creditsLeft")}
        </span>
      </div>

      <div
        className={cn("relative h-1 w-full", {
          "bg-success/35": level === "high",
          "bg-yellow-500/35": level === "medium",
          "bg-destructive/35": level === "low",
        })}
      >
        <motion.div
          className={cn("absolute top-0 left-0 h-1 w-full origin-left", {
            "bg-success": level === "high",
            "bg-yellow-500": level === "medium",
            "bg-destructive": level === "low",
          })}
          initial={{
            scaleX: 0,
          }}
          animate={{
            scaleX: progress,
          }}
        />
      </div>
    </li>
  );
};
