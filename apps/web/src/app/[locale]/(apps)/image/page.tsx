"use client";

import { useMemo } from "react";

import { generateId } from "@turbostarter/shared/utils";

import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";
import { NewGeneration } from "~/modules/image/generation/new";
import { ViewGeneration } from "~/modules/image/generation/view";
import { HistoryCta } from "~/modules/image/history/cta";
import { useImageGeneration } from "~/modules/image/use-image-generation";

const Image = () => {
  const id = useMemo(() => generateId(), []);

  const { generation } = useImageGeneration({
    id,
  });

  if (generation) {
    return <ViewGeneration id={id} />;
  }

  return <NewGeneration id={id} />;
};

export default function Page() {
  return (
    <>
      <Header className="bg-transparent">
        <div className="flex items-center gap-1">
          <HistoryCta />
          <ThemeSwitcher />
        </div>
      </Header>
      <Image />
    </>
  );
}
