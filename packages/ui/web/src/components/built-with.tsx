"use client";

import * as React from "react";

import { cn } from "@turbostarter/ui";

import { buttonVariants } from "#components/button";

export const BuiltWith = ({
  className,
  ...props
}: React.ComponentProps<"a">) => {
  return (
    <a
      className={cn(
        buttonVariants({
          variant: "outline",
          className: "cursor-pointer gap-1.5 font-sans text-xs",
        }),
        className,
      )}
      href="https://github.com/alezmad/claude-intercom"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      <span className="text-muted-foreground">Built on</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-foreground"
        aria-hidden="true"
      >
        <path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 011.3-3.3c-.2-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 3 .1 3.3a4.7 4.7 0 011.3 3.3c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3" />
      </svg>
      <span className="font-medium">claude-intercom</span>
      <span className="text-muted-foreground">· MIT</span>
    </a>
  );
};
