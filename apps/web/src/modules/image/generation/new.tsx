"use client";

import { memo, useState } from "react";

import { ImageComposer } from "../composer";
import { BackgroundGrid } from "../layout/background-grid";
import { Examples } from "../layout/examples";
import { Headline } from "../layout/headline";

interface NewGenerationProps {
  readonly id: string;
}

export const NewGeneration = memo<NewGenerationProps>(({ id }) => {
  const [prompt, setPrompt] = useState("");
  return (
    <>
      <BackgroundGrid />
      <div className="absolute inset-0 z-10 mx-auto flex h-full w-full flex-col items-center justify-between gap-6 md:justify-center md:gap-9 md:p-2">
        <div className="flex w-full grow items-end justify-center">
          <Headline />
        </div>
        <div className="flex w-full grow flex-col items-center justify-between md:flex-col-reverse md:justify-end md:gap-5">
          <Examples className="flex" onSelect={setPrompt} />
          <div className="relative w-full px-3 pb-3">
            <ImageComposer
              id={id}
              prompt={prompt}
              reset={() => setPrompt("")}
            />
          </div>
        </div>
      </div>
    </>
  );
});

NewGeneration.displayName = "NewImageGeneration";
