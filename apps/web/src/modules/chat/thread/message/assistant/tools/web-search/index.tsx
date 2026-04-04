/* eslint-disable @next/next/no-img-element */
import { motion } from "motion/react";
import { useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@turbostarter/ui-web/accordion";
import { Badge } from "@turbostarter/ui-web/badge";
import { Icons } from "@turbostarter/ui-web/icons";

import { ImageGrid } from "./images";
import { SearchLoading } from "./loading";

import type {
  ChatDataParts,
  ChatTools,
  Tool,
} from "@turbostarter/ai/chat/types";
import type { DataUIPart } from "ai";

const ResultCard = ({
  result,
}: {
  result: SearchResult["results"][number];
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div className="border-border bg-background h-full w-[300px] shrink-0 rounded-xl border shadow-xs">
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="bg-muted relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            {!imageLoaded && (
              <div className="bg-muted-foreground/10 absolute inset-0 animate-pulse" />
            )}
            <img
              src={`https://www.google.com/s2/favicons?sz=128&domain=${new URL(result.url).hostname}`}
              alt=""
              className={cn("size-8 object-cover", !imageLoaded && "opacity-0")}
              onLoad={() => setImageLoaded(true)}
              onError={(e) => {
                setImageLoaded(true);
                e.currentTarget.src =
                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='8' x2='12' y2='16'/%3E%3Cline x1='8' y1='12' x2='16' y2='12'/%3E%3C/svg%3E";
              }}
            />
          </div>
          <div>
            <h3 className="line-clamp-1 text-sm font-medium">{result.title}</h3>
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              {new URL(result.url).hostname}
              <Icons.ExternalLink className="size-2.5" />
            </a>
          </div>
        </div>

        <p className="text-muted-foreground line-clamp-3 text-sm">
          {result.content}
        </p>

        {result.publishedDate && (
          <div className="pt-2">
            <time className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Icons.Calendar className="size-3" />
              {new Date(result.publishedDate).toLocaleDateString()}
            </time>
          </div>
        )}
      </div>
    </div>
  );
};

export type SearchResult = NonNullable<
  ChatTools[typeof Tool.WEB_SEARCH]["output"]
>["searches"][number];

export const WebSearch = (
  props: Partial<ChatTools[typeof Tool.WEB_SEARCH]> & {
    annotations: DataUIPart<ChatDataParts>[];
  },
) => {
  const { input, output, annotations } = props;
  const { t } = useTranslation("common");

  if (!output) {
    return (
      <SearchLoading queries={input?.queries ?? []} annotations={annotations} />
    );
  }

  const allImages = output.searches.reduce<SearchResult["images"]>(
    (acc, search) => {
      return [...acc, ...search.images];
    },
    [],
  );

  const totalResults = output.searches.reduce(
    (sum, search) => sum + search.results.length,
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
              "border-border bg-background rounded-xl border p-3 pr-4 shadow-xs hover:no-underline",
              "[&[data-state=open]]:rounded-b-none",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-muted rounded-lg p-1.5">
                  <Icons.Globe className="text-muted-foreground size-4" />
                </div>
                <h2 className="text-left font-medium">
                  {t("search.completed")}
                </h2>
              </div>
              <div className="mr-2 flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-muted rounded-full px-3 py-1"
                >
                  <Icons.Search className="mr-1.5 size-3" />
                  {totalResults} {t("results")}
                </Badge>
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent className="mt-0 border-0 py-0">
            <div className="border-border bg-background rounded-b-xl border border-t-0 px-4 py-3 shadow-xs">
              <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
                {output.searches.map((search, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="bg-muted flex-shrink-0 rounded-full px-3 py-1.5"
                  >
                    <Icons.Search className="mr-1.5 size-3" />
                    {search.query.q}
                  </Badge>
                ))}
              </div>

              <div className="no-scrollbar flex gap-3 overflow-x-auto">
                {output.searches.map((search) =>
                  search.results.map((result, resultIndex) => (
                    <motion.div
                      key={`${search.query.q}-${resultIndex}`}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: resultIndex * 0.1 }}
                    >
                      <ResultCard result={result} />
                    </motion.div>
                  )),
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {allImages.length > 0 && <ImageGrid images={allImages} />}
    </div>
  );
};
