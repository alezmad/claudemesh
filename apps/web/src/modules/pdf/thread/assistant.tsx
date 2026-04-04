import { memo, useEffect, useRef } from "react";

import { getMessageTextContent } from "@turbostarter/ai";
import { cn } from "@turbostarter/ui";

import { ThreadMessageLikes } from "~/modules/common/ai/thread/controls/likes";
import { ThreadMessage } from "~/modules/common/ai/thread/message";
import { Prose } from "~/modules/common/prose";

import { usePdfViewer } from "../context";

import { CitationMarkdown } from "./citation-markdown";
import { CopyWithCitations } from "./copy-with-citations";

import type { PdfMessage, PreciseCitation } from "@turbostarter/ai/pdf/types";
import type { ThreadMessageProps } from "~/modules/common/ai/thread/message";

/**
 * Extract PreciseCitation results from highlightText tool calls in message parts.
 * Tool parts are typed as "tool-{toolName}" in Vercel AI SDK.
 */
function extractHighlightCitations(message: PdfMessage): PreciseCitation[] {
  const citations: PreciseCitation[] = [];

  for (const part of message.parts) {
    if (part.type === "tool-highlightText") {
      // Tool invocations have different states - only extract when result is available
      const toolPart = part as unknown as { state: string; output?: PreciseCitation };
      if (toolPart.state === "result" && toolPart.output) {
        citations.push(toolPart.output);
      }
    }
  }

  return citations;
}

/**
 * Assistant message component with citation support.
 * Renders AI responses with clickable [[cite:id:page]] markers as interactive citations.
 * Also triggers text highlights in the PDF viewer when highlightText tool is invoked.
 */
export const AssistantMessage = memo<ThreadMessageProps<PdfMessage>>(
  ({ message, ref, status }) => {
    const { addTextHighlight } = usePdfViewer();
    const processedCitationsRef = useRef<Set<string>>(new Set());

    // Process highlightText tool invocations and trigger highlights
    useEffect(() => {
      const citations = extractHighlightCitations(message);

      for (const citation of citations) {
        // Only process each citation once (avoid duplicate highlights on re-renders)
        if (!processedCitationsRef.current.has(citation.citationId)) {
          processedCitationsRef.current.add(citation.citationId);
          addTextHighlight(citation);
        }
      }
    }, [message, addTextHighlight]);

    const hasTextContent = message.parts.some(
      (part) => part.type === "text" && part.text.length > 0
    );

    return (
      <ThreadMessage.Layout className="items-start" ref={ref}>
        <Prose className="w-full max-w-none">
          <CitationMarkdown
            id={message.id}
            content={getMessageTextContent(message)}
          />
        </Prose>

        {!["submitted", "streaming"].includes(status) && (
          <div
            className={cn(
              "bg-background start-0 -ml-4 flex w-max items-center gap-px rounded-lg px-2 pb-2 text-xs",
              "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:start-3"
            )}
          >
            {hasTextContent && <CopyWithCitations message={message} />}
            <ThreadMessageLikes />
          </div>
        )}
      </ThreadMessage.Layout>
    );
  },
);

AssistantMessage.displayName = "AssistantMessage";
