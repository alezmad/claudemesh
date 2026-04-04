"use client";

import "katex/dist/katex.min.css";
import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { rehypeInlineCodeProperty } from "react-shiki";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CodeHighlight } from "~/modules/common/markdown/code";
import { preprocessMarkdown } from "~/modules/common/markdown/utils";

import { Citation } from "../components/citation";
import { CitationPreview } from "../components/citation-preview";

import type { Citation as CitationType } from "@turbostarter/ai/pdf/types";

// ============================================================================
// Types
// ============================================================================

interface CitationMarkdownProps {
  content: string;
  id: string;
}

interface ParsedContent {
  /** Content with citation markers replaced with placeholders */
  text: string;
  /** Parsed citations */
  citations: CitationType[];
}

// ============================================================================
// Citation Parser
// ============================================================================

const CITATION_REGEX = /\[\[cite:([a-zA-Z0-9]+):(\d+)\]\]/g;

/**
 * Parse citation markers from content and extract citation data
 * Returns content with markers replaced by `[n]` placeholders and citation array
 */
function parseCitationsFromContent(content: string): ParsedContent {
  const citations: CitationType[] = [];
  const seenIds = new Map<string, number>();

  const parsedText = content.replace(
    CITATION_REGEX,
    (_match, embeddingId: string, pageNumStr: string) => {
      const pageNumber = parseInt(pageNumStr, 10);

      // Check if we've seen this embeddingId before
      if (seenIds.has(embeddingId)) {
        const existingIndex = seenIds.get(embeddingId)!;
        return `[[CITE_PLACEHOLDER:${existingIndex}]]`;
      }

      // New citation
      const index = citations.length + 1;
      seenIds.set(embeddingId, index);

      citations.push({
        index,
        embeddingId,
        pageNumber,
        relevance: 0.9, // Default - actual relevance from embedding search
        excerpt: "", // Will be populated if we have the embedding data
      });

      return `[[CITE_PLACEHOLDER:${index}]]`;
    }
  );

  return { text: parsedText, citations };
}

/**
 * Split content into text segments and citation placeholders
 */
function splitContentWithCitations(
  content: string,
  citations: CitationType[]
): { type: "text" | "citation"; value: string | CitationType }[] {
  const PLACEHOLDER_REGEX = /\[\[CITE_PLACEHOLDER:(\d+)\]\]/g;
  const segments: { type: "text" | "citation"; value: string | CitationType }[] = [];

  let lastIndex = 0;
  let match;

  while ((match = PLACEHOLDER_REGEX.exec(content)) !== null) {
    // Add text before the placeholder
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        value: content.slice(lastIndex, match.index),
      });
    }

    // Add citation
    const citationIndex = parseInt(match[1] ?? "0", 10);
    const citation = citations.find((c) => c.index === citationIndex);
    if (citation) {
      segments.push({ type: "citation", value: citation });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }

  return segments;
}

// ============================================================================
// Markdown Block Component
// ============================================================================

const MarkdownSegment = memo(({ content }: { content: string }) => {
  const processedContent = preprocessMarkdown(content);
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw, rehypeKatex, rehypeInlineCodeProperty]}
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{
        code: CodeHighlight,
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
});

MarkdownSegment.displayName = "MarkdownSegment";

// ============================================================================
// Citation Markdown Component
// ============================================================================

/**
 * Markdown renderer with inline citation support.
 * Parses [[cite:embeddingId:pageNum]] markers and renders them as clickable citations.
 *
 * @example
 * ```tsx
 * <CitationMarkdown
 *   content="The contract states X [[cite:abc123:5]] and Y [[cite:def456:8]]."
 *   id="msg-1"
 * />
 * // Renders markdown with [1] and [2] as clickable citation buttons
 * ```
 */
export const CitationMarkdown = memo<CitationMarkdownProps>(
  ({ content, id }) => {
    // Parse citations from raw content
    const { text: parsedText, citations } = useMemo(
      () => parseCitationsFromContent(content),
      [content]
    );

    // Parse markdown into blocks - use parsedText if we have citations, raw content otherwise
    const blocks = useMemo(() => {
      const textToParse = citations.length === 0 ? content : parsedText;
      const tokens = marked.lexer(textToParse);
      return tokens.map((token) => token.raw);
    }, [content, parsedText, citations.length]);

    // If no citations, render as regular markdown
    if (citations.length === 0) {
      return blocks.map((block, index) => (
        <MarkdownSegment content={block} key={`${id}-block_${index}`} />
      ));
    }

    // Render each block, handling citation placeholders
    return blocks.map((block, blockIndex) => {
      // Check if this block contains citation placeholders
      if (!block.includes("[[CITE_PLACEHOLDER:")) {
        // For tiny punctuation-only blocks, render as plain inline text
        // to avoid orphan dots/punctuation wrapped in <p> tags
        const trimmedBlock = block.trim();
        if (trimmedBlock.length <= 3 && /^[.,;:!?)\]}>…]+$/.test(trimmedBlock)) {
          return <span key={`${id}-block_${blockIndex}`}>{trimmedBlock}</span>;
        }
        return (
          <MarkdownSegment content={block} key={`${id}-block_${blockIndex}`} />
        );
      }

      // Split block into segments with citations
      const segments = splitContentWithCitations(block, citations);

      return (
        <span key={`${id}-block_${blockIndex}`} className="inline">
          {segments.map((segment, segIndex) => {
            if (segment.type === "text") {
              let textContent = segment.value as string;

              // Strip leading dot if this segment follows a citation
              // (dots after citations look bad visually)
              const prevSegment = segments[segIndex - 1];
              if (prevSegment?.type === "citation") {
                textContent = textContent.replace(/^\./, "");
              }

              const trimmed = textContent.trim();

              // Skip empty segments after stripping
              if (!trimmed) {
                return null;
              }

              // For text segments, render inline markdown
              return (
                <MarkdownSegment
                  key={`${id}-seg_${blockIndex}_${segIndex}`}
                  content={textContent}
                />
              );
            }

            // Citation segment - render interactive citation
            const citation = segment.value as CitationType;
            return (
              <CitationPreview
                key={`${id}-cite_${blockIndex}_${segIndex}`}
                citation={citation}
              >
                <Citation citation={citation} />
              </CitationPreview>
            );
          })}
        </span>
      );
    });
  }
);

CitationMarkdown.displayName = "CitationMarkdown";

export default CitationMarkdown;
