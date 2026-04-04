import { cn } from "@turbostarter/ui";

export const Section = ({
  className,
  ...props
}: React.ComponentProps<"section">) => {
  return (
    <section
      className={cn(
        "mx-auto flex flex-col items-center gap-10 px-6 py-10 sm:container sm:gap-12 sm:py-12 md:gap-16 md:py-16 lg:gap-20 lg:py-20",
        className,
      )}
      {...props}
    />
  );
};

export const SectionHeader = ({
  className,
  ...props
}: React.ComponentProps<"header">) => {
  return (
    <header
      className={cn(
        "mx-auto flex max-w-5xl flex-col items-center gap-3 text-center",
        className,
      )}
      {...props}
    />
  );
};

export const SectionBadge = ({
  className,
  ...props
}: React.ComponentProps<"div">) => {
  return (
    <div
      className={cn(
        "group text-foreground hover:bg-accent/50 focus:ring-ring inline-flex h-8 items-center rounded-full border px-3 py-0.5 text-xs font-medium shadow-xs transition-colors duration-200 focus:ring-2 focus:ring-offset-2 focus:outline-none sm:text-sm",
        className,
      )}
      {...props}
    />
  );
};

export const SectionTitle = ({
  as,
  className,
  ...props
}: Omit<React.ComponentProps<"h2">, "ref"> & {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}) => {
  const As = as ?? "h2";

  return (
    <As
      className={cn(
        "mt-4 max-w-4xl text-4xl leading-[0.95] font-semibold tracking-tighter text-balance md:text-5xl lg:text-6xl",
        className,
      )}
      {...props}
    />
  );
};

export const SectionDescription = ({
  className,
  ...props
}: React.ComponentProps<"p">) => {
  return (
    <p
      className={cn(
        "text-muted-foreground max-w-6xl text-balance lg:text-lg",
        className,
      )}
      {...props}
    />
  );
};
