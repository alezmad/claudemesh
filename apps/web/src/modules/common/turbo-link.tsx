"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ComponentProps } from "react";

type TurboLinkProps = ComponentProps<typeof Link>;

export const TurboLink = ({
  onMouseEnter,
  onPointerEnter,
  onTouchStart,
  onFocus,
  children,
  ...props
}: TurboLinkProps) => {
  const router = useRouter();
  const strHref =
    typeof props.href === "string" ? props.href : props.href.href;

  const conditionalPrefetch = () => {
    if (strHref) {
      void router.prefetch(strHref);
    }
  };

  return (
    <Link
      {...props}
      prefetch={false}
      onMouseEnter={(e) => {
        conditionalPrefetch();
        onMouseEnter?.(e);
      }}
      onPointerEnter={(e) => {
        conditionalPrefetch();
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        conditionalPrefetch();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        conditionalPrefetch();
        onFocus?.(e);
      }}
    >
      {children}
    </Link>
  );
};
