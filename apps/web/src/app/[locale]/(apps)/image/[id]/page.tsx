import { notFound } from "next/navigation";

import { generationSchema } from "@turbostarter/ai/image/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";
import { ViewGeneration } from "~/modules/image/generation/view";
import { HistoryCta } from "~/modules/image/history/cta";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) => {
  const id = (await params).id;
  const generation = await handle(api.ai.image.generations[":id"].$get)({
    param: { id },
  });

  return getMetadata({
    ...(generation?.prompt && {
      title:
        generation.prompt.length > 50
          ? `${generation.prompt.slice(0, 50)}...`
          : generation.prompt,
    }),
  })({ params });
};

export default async function ImageGeneration({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;

  const generation = await handle(api.ai.image.generations[":id"].$get, {
    schema: generationSchema.nullable(),
  })({
    param: { id },
  });

  if (!generation) {
    return notFound();
  }

  const images = await handle(api.ai.image.generations[":id"].images.$get)({
    param: { id },
  });

  return (
    <>
      <Header>
        <div className="flex items-center gap-1">
          <HistoryCta />
          <ThemeSwitcher />
        </div>
      </Header>
      <ViewGeneration
        id={id}
        initialGeneration={{
          ...generation,
          input: {
            prompt: generation.prompt,
            options: generation,
          },
          images: images.map((image) => ({
            url: image.url,
          })),
        }}
      />
    </>
  );
}
