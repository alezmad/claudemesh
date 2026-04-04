import { useEffect, useRef } from "react";

import { cn } from "@turbostarter/ui";
import { TextareaAutosize } from "@turbostarter/ui-web/textarea";

import { Attachments } from "./attachments";

const Form = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) => {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      ref.current
        ?.closest("main")
        ?.style.setProperty(
          "--composer-height",
          `${entry.contentRect.height}px`,
        );
    });

    if (ref.current) {
      resizeObserver.observe(ref.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <form
      ref={ref}
      className={cn(
        "relative bottom-0 z-10 flex w-full flex-col items-center justify-center gap-2 text-base",
        className,
      )}
      {...props}
    >
      {children}
    </form>
  );
};

const Input = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "bg-card/65 ring-border/75 focus-within:ring-input hover:ring-input hover:focus-within:ring-input @container/input relative w-full max-w-200 rounded-2xl px-2 pb-2 ring-1 backdrop-blur-xl duration-100 ring-inset focus-within:ring-1 @lg:rounded-3xl @lg:shadow-xs",
        className,
      )}
      {...props}
    />
  );
};

const Textarea = ({
  className,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "style">) => {
  return (
    <TextareaAutosize
      dir="auto"
      className={cn(
        "text-foreground mb-3 min-h-20 w-full resize-none bg-transparent px-2 pt-5 align-bottom focus:outline-none @[480px]/input:px-3",
        className,
      )}
      spellCheck={false}
      maxRows={6}
      autoFocus
      maxLength={5_000}
      {...props}
    />
  );
};

export const Composer = {
  Form,
  Input,
  Textarea,
  Attachments,
};
