"use client";

import { useCallback, useMemo } from "react";

import { Role } from "@turbostarter/ai/pdf/types";
import { useTranslation } from "@turbostarter/i18n";
import { Icons } from "@turbostarter/ui-web/icons";

import { Thread } from "~/modules/common/ai/thread";

import { TextSelectionAction } from "../components/text-selection-action";
import { useComposer } from "../composer/use-composer";

import { AssistantMessage } from "./assistant";
import { FollowUpSuggestions } from "./follow-up-suggestions";
import { SuggestedQuestions } from "./suggested-questions";
import { UserMessage } from "./user";

import type { PdfMessage } from "@turbostarter/ai/pdf/types";

interface ChatProps {
  readonly id?: string;
  readonly initialMessages?: PdfMessage[];
}

const components = {
  [Role.USER]: UserMessage,
  [Role.ASSISTANT]: AssistantMessage,
};

export const Chat = ({ id, initialMessages }: ChatProps = {}) => {
  const { t } = useTranslation("ai");
  const { messages, regenerate, error, status, sendMessage } = useComposer({
    id,
    initialMessages,
  });

  const handleSuggestedQuestion = useCallback(
    (question: string) => {
      void sendMessage({ text: question });
    },
    [sendMessage]
  );

  const handleAskAboutSelection = useCallback(
    (selectedText: string) => {
      // Format the question with the selected text
      const question = `Regarding this text from the document: "${selectedText}"\n\nCan you explain what this means?`;
      void sendMessage({ text: question });
    },
    [sendMessage]
  );

  // Show follow-up suggestions after the last assistant message when ready
  const showFollowUp = useMemo(() => {
    if (status !== "ready") return false;
    if (messages.length === 0) return false;
    return messages.at(-1)?.role === Role.ASSISTANT;
  }, [status, messages]);

  const isDisabled = ["submitted", "streaming"].includes(status);

  if (!messages.length) {
    return (
      <>
        <TextSelectionAction
          onAskAbout={handleAskAboutSelection}
          disabled={isDisabled}
        />
        <div className="flex w-full grow flex-col items-center justify-center gap-6 px-6">
          <div className="flex flex-col items-center gap-2">
            <Icons.ScrollText className="text-muted-foreground size-20 stroke-[1.5]" />
            <p className="text-muted-foreground max-w-sm text-center">
              {t("pdf.composer.empty")}
            </p>
          </div>
          <SuggestedQuestions
            onSelect={handleSuggestedQuestion}
            disabled={isDisabled}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <TextSelectionAction
        onAskAbout={handleAskAboutSelection}
        disabled={isDisabled}
      />
      <Thread
        messages={messages}
        initialMessages={initialMessages}
        status={status}
        components={components}
        error={error}
        regenerate={regenerate}
        footer={
          showFollowUp ? (
            <div className="mx-auto w-full max-w-3xl px-4">
              <FollowUpSuggestions
                onSelect={handleSuggestedQuestion}
                disabled={isDisabled}
              />
            </div>
          ) : null
        }
      />
    </>
  );
};
