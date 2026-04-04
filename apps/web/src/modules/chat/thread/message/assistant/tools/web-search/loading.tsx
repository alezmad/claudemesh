import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { useBreakpoint } from "@turbostarter/ui-web";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@turbostarter/ui-web/accordion";
import { Badge } from "@turbostarter/ui-web/badge";
import { Icons } from "@turbostarter/ui-web/icons";
import { Skeleton } from "@turbostarter/ui-web/skeleton";

import { PREVIEW_IMAGE_COUNT } from "./images";

import type {
  ChatTools,
  ChatDataParts,
  Tool,
} from "@turbostarter/ai/chat/types";
import type { DataUIPart } from "ai";

export const SearchLoading = ({
  queries,
  annotations,
}: {
  queries: ChatTools[typeof Tool.WEB_SEARCH]["input"]["queries"];
  annotations: DataUIPart<ChatDataParts>[];
}) => {
  const isDesktop = useBreakpoint("md");
  const { t } = useTranslation("common");
  const totalResults = annotations.reduce(
    (sum, a) => sum + a.data.resultsCount,
    0,
  );

  return (
    <div className="not-prose w-full space-y-4 pb-2">
      <Accordion
        type="single"
        collapsible
        defaultValue="search"
        className="w-full"
      >
        <AccordionItem value="search" className="border-none [&_h3]:my-0">
          <AccordionTrigger
            className={cn(
              "border-border bg-background rounded-xl border p-3 shadow-xs hover:no-underline",
              "data-[state=open]:rounded-b-none",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-muted rounded-lg p-1.5">
                  <Icons.Loader className="text-muted-foreground size-4 animate-spin" />
                </div>
                <h2 className="text-left font-medium">
                  {t("search.inProgress")}
                </h2>
              </div>
              <div className="mr-2 flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-muted rounded-full px-3 py-1"
                >
                  <Icons.Search className="mr-1.5 size-3" />
                  {totalResults || "0"} {t("results")}
                </Badge>
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent className="mt-0 border-0 py-0">
            <div className="border-border bg-background rounded-b-xl border border-t-0 px-4 py-3 shadow-xs">
              <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
                {queries.map((query, i) => {
                  const annotation = annotations.find(
                    (a) =>
                      a.data.query.q === query.q &&
                      a.data.status === "completed",
                  );

                  return (
                    <Badge
                      key={i}
                      variant="secondary"
                      className={cn(
                        "shrink-0 gap-1.5 rounded-full px-3 py-1.5",
                        !annotation && "text-muted-foreground",
                      )}
                    >
                      {annotation ? (
                        <Icons.Check className="size-3" />
                      ) : (
                        <Icons.Loader2 className="size-3 animate-spin stroke-[3px]" />
                      )}
                      {query.q}
                    </Badge>
                  );
                })}
              </div>

              <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="border-border bg-background w-[300px] shrink-0 rounded-xl border shadow-xs"
                  >
                    <div className="p-4">
                      <div className="mb-3 flex items-center gap-2.5">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                        <Skeleton className="h-3 w-4/6" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({
          length: isDesktop
            ? PREVIEW_IMAGE_COUNT.DESKTOP
            : PREVIEW_IMAGE_COUNT.MOBILE,
        }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              "aspect-4/3 rounded-xl",
              i === 0 && "sm:col-span-2 sm:row-span-2",
            )}
          />
        ))}
      </div>
    </div>
  );
};
