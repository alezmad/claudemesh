"use client";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

// ============================================================================
// Types
// ============================================================================

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
  disabled?: boolean;
}

// ============================================================================
// Suggested Questions
// ============================================================================

/**
 * Starter questions shown when chat is empty.
 * Clicking a question sends it as the first message.
 */
export function SuggestedQuestions({
  onSelect,
  disabled,
}: SuggestedQuestionsProps) {
  const { t } = useTranslation("ai");

  const questions = [
    {
      icon: Icons.FileText,
      text: t("pdf.suggestions.summarize"),
    },
    {
      icon: Icons.BookOpen,
      text: t("pdf.suggestions.keyPoints"),
    },
    {
      icon: Icons.Lightbulb,
      text: t("pdf.suggestions.explain"),
    },
    {
      icon: Icons.Search,
      text: t("pdf.suggestions.find"),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-center text-sm">
        {t("pdf.suggestions.title")}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {questions.map((q, i) => (
          <Button
            key={i}
            variant="outline"
            className={cn(
              "h-auto justify-start gap-3 px-4 py-3 text-left",
              "hover:bg-accent hover:text-accent-foreground",
              "transition-colors"
            )}
            onClick={() => onSelect(q.text)}
            disabled={disabled}
          >
            <q.icon className="text-muted-foreground size-4 shrink-0" />
            <span className="line-clamp-2 text-sm">{q.text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export default SuggestedQuestions;
