"use client";

import { motion } from "motion/react";
import { memo } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

import { useComposer } from "~/modules/chat/composer/hooks/use-composer";

const examples = [
  {
    icon: Icons.FileText,
    label: "chat.example.summarize.label",
    prompt: "chat.example.summarize.prompt",
  },
  {
    icon: Icons.ChartNoAxesColumn,
    label: "chat.example.analyze.label",
    prompt: "chat.example.analyze.prompt",
  },
  {
    icon: Icons.Code,
    label: "chat.example.code.label",
    prompt: "chat.example.code.prompt",
  },
  {
    icon: Icons.Zap,
    label: "chat.example.brainstorm.label",
    prompt: "chat.example.brainstorm.prompt",
  },
  {
    icon: Icons.PackageOpen,
    label: "chat.example.surprise.label",
    prompt: "chat.example.surprise.prompt",
  },
] as const;

interface ExamplesProps {
  readonly id?: string;
  readonly className?: string;
}

export const Examples = memo<ExamplesProps>(({ className, id }) => {
  const { t } = useTranslation("ai");
  const { onSubmit } = useComposer({ id });

  return (
    <div
      className={cn(
        "flex w-full flex-row flex-wrap items-center justify-center gap-2 px-3 @sm:gap-2",
        className,
      )}
    >
      {examples.map(({ icon: Icon, label, prompt }, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          initial={{ opacity: 0, y: 3, filter: "blur(4px)" }}
          transition={{ delay: index * 0.1 }}
          key={label}
        >
          <Button
            variant="outline"
            className="text-muted-foreground gap-2 rounded-full"
            onClick={() => onSubmit(t(prompt))}
          >
            <Icon className="size-4" />
            <span>{t(label)}</span>
          </Button>
        </motion.div>
      ))}
    </div>
  );
});

Examples.displayName = "Examples";
