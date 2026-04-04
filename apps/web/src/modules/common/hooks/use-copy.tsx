import { useCallback, useEffect, useState } from "react";

type CopiedValue = string | null;
type CopyFn = (text: string) => Promise<boolean>;

export function useCopy() {
  const [text, setText] = useState<CopiedValue>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (copied) {
      timeoutId = setTimeout(() => {
        setCopied(false);
        setText(null);
      }, 3000);
    }
    return () => clearTimeout(timeoutId);
  }, [copied]);

  const copy: CopyFn = useCallback(async (text) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!navigator?.clipboard) {
      console.warn("Clipboard not supported");
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setText(text);
      setCopied(true);
      return true;
    } catch (error) {
      console.warn("Copy failed", error);
      setText(null);
      setCopied(false);
      return false;
    }
  }, []);

  return {
    copied,
    copy,
    text,
  };
}
