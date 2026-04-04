"use client";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

// ============================================================================
// Types
// ============================================================================

interface FollowUpSuggestionsProps {
  onSelect: (question: string) => void;
  disabled?: boolean;
}

// ============================================================================
// Follow-up Suggestions
// ============================================================================

/**
 * Contextual follow-up questions shown after AI responses.
 * Helps users continue the conversation with relevant questions.
 */
export function FollowUpSuggestions({
  onSelect,
  disabled,
}: FollowUpSuggestionsProps) {
  const { t } = useTranslation("ai");

  const suggestions = [
    {
      icon: Icons.Search,
      text: t("pdf.followUp.moreDetail"),
    },
    {
      icon: Icons.MessageCircle,
      text: t("pdf.followUp.clarify"),
    },
    {
      icon: Icons.ArrowRight,
      text: t("pdf.followUp.continue"),
    },
  ];

  return (
    <div className="flex flex-wrap gap-2 pt-2 pb-4">
      {suggestions.map((s, i) => (
        <Button
          key={i}
          variant="outline"
          size="sm"
          className={cn(
            "h-auto gap-2 px-3 py-1.5 text-xs",
            "hover:bg-accent hover:text-accent-foreground",
            "border-dashed transition-colors"
          )}
          onClick={() => onSelect(s.text)}
          disabled={disabled}
        >
          <s.icon className="text-muted-foreground size-3 shrink-0" />
          <span>{s.text}</span>
        </Button>
      ))}
    </div>
  );
}

export default FollowUpSuggestions;
