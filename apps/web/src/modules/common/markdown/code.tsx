import { useTheme } from "next-themes";
import ShikiHighlighter from "react-shiki";

import { cn } from "@turbostarter/ui";

import type { ReactNode } from "react";
import type { Element } from "react-shiki";

interface CodeHighlightProps {
  className?: string | undefined;
  children?: ReactNode | undefined;
  node?: Element | undefined;
  inline?: boolean;
}

export const CodeHighlight = ({
  inline = false,
  className,
  children,
  ...props
}: CodeHighlightProps) => {
  const { resolvedTheme } = useTheme();
  const match = className?.match(/language-(\w+)/);
  const language = match ? match[1] : undefined;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const code = String(children).trim();

  return !inline ? (
    <ShikiHighlighter
      language={language}
      theme={`github-${resolvedTheme === "dark" ? "dark" : "light"}`}
      {...props}
      className={cn(
        "overflow-hidden rounded-none border-y @md:rounded-lg @md:border",
        className,
      )}
    >
      {code}
    </ShikiHighlighter>
  ) : (
    <code className={className} {...props}>
      {children}
    </code>
  );
};
