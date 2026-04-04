"use client";

import { motion } from "motion/react";
import { memo } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

interface ExamplesProps {
  readonly className?: string;
  readonly onSelect: (prompt: string) => void;
}

const examples = [
  {
    label: "image.example.fox.label",
    prompt: "image.example.fox.prompt",
  },
  {
    label: "image.example.penguin.label",
    prompt: "image.example.penguin.prompt",
  },
  {
    label: "image.example.raccoon.label",
    prompt: "image.example.raccoon.prompt",
  },
  {
    label: "image.example.elephant.label",
    prompt: "image.example.elephant.prompt",
  },
  {
    label: "image.example.dolphin.label",
    prompt: "image.example.dolphin.prompt",
  },
] as const;

export const Examples = memo<ExamplesProps>(({ className, onSelect }) => {
  const { t } = useTranslation("ai");

  return (
    <div
      className={cn(
        "flex w-full flex-row flex-wrap items-center justify-center gap-2 px-3 @sm:gap-2",
        className,
      )}
    >
      {examples.map(({ label, prompt }, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          initial={{ opacity: 0, y: 3, filter: "blur(4px)" }}
          transition={{ delay: index * 0.1 }}
          key={label}
        >
          <Button
            variant="outline"
            className="bg-background/50 text-muted-foreground gap-1 rounded-full border-none backdrop-blur-lg"
            onClick={() => onSelect(t(prompt))}
          >
            <span className="lowercase">{t(label)}</span>
            <Icons.ArrowUpRight className="size-4" />
          </Button>
        </motion.div>
      ))}
    </div>
  );
});

Examples.displayName = "Examples";
