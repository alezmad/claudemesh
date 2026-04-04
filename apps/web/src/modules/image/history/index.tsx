"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { buttonVariants } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";
import { ScrollArea } from "@turbostarter/ui-web/scroll-area";

import { pathsConfig } from "~/config/paths";
import { authClient } from "~/lib/auth/client";
import { useIntersectionObserver } from "~/modules/common/hooks/use-intersection-observer";
import { TurboLink } from "~/modules/common/turbo-link";

import { Images } from "../generation/view/images";
import { image } from "../lib/api";

const Headline = () => {
  const { t } = useTranslation("ai");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex w-full items-start justify-between gap-3">
        <h1 className="text-4xl font-semibold">{t("image.history.title")}</h1>

        <TurboLink
          href={pathsConfig.apps.image.index}
          className={cn(
            buttonVariants(),
            "h-9 w-9 gap-2 p-0 @lg:h-10 @lg:w-auto @lg:px-4 @lg:py-2",
          )}
        >
          <Icons.Plus className="size-5" />
          <span className="hidden @lg:inline">{t("image.generation.new")}</span>
        </TurboLink>
      </div>
      <p className="text-muted-foreground max-w-lg leading-snug @lg:text-lg">
        {t("image.history.description")}
      </p>
    </div>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ScrollArea className="h-full w-full">
      <div className="flex h-full w-full flex-1 flex-col gap-8 px-5 pt-16 pb-5 md:px-6 md:pt-18 md:pb-6">
        {children}
      </div>
    </ScrollArea>
  );
};

const Content = () => {
  const { data: session } = authClient.useSession();

  const { isIntersecting, ref } = useIntersectionObserver({
    threshold: 0.5,
  });

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    isError,
    hasNextPage,
    refetch,
  } = useInfiniteQuery({
    ...image.queries.images.user.getAll(session?.user.id ?? ""),
    getNextPageParam: (lastPage) => lastPage.at(-1)?.createdAt,
    initialPageParam: undefined,
  });

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const images = data?.pages.flatMap((page) => page) ?? [];

  if (isLoading) {
    return (
      <Images.Layout>
        <Images.Loading />
      </Images.Layout>
    );
  }

  if (isError) {
    return <Images.Error onRetry={() => refetch()} />;
  }

  if (!images.length) {
    return <Images.Empty />;
  }

  return (
    <>
      <Images.Layout>
        <Images.Grid
          images={images.map((image) => ({
            ...image,
            ...image.generation,
            description: image.generation.prompt,
          }))}
          fetching={isFetchingNextPage}
          withDetails
        />
      </Images.Layout>

      <div ref={ref} className="-mt-8 h-5 @lg:h-6" />
    </>
  );
};

export const History = () => {
  return (
    <Layout>
      <Headline />
      <Content />
    </Layout>
  );
};
