import "katex/dist/katex.min.css";
import { marked } from "marked";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { rehypeInlineCodeProperty } from "react-shiki";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CodeHighlight } from "./code";
import { preprocessMarkdown } from "./utils";

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
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
  },
  (prevProps, nextProps) => {
    if (prevProps.content !== nextProps.content) return false;
    return true;
  },
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export const MemoizedMarkdown = memo<{ content: string; id: string }>(
  ({ content, id }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

    return blocks.map((block, index) => (
      <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
    ));
  },
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";
