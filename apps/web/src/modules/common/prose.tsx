import { cn } from "@turbostarter/ui";

export const Prose = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "prose dark:prose-invert prose-p:opacity-95 prose-strong:opacity-100 prose-pre:-mx-5 prose-pre:rounded-none prose-pre:bg-transparent prose-pre:p-0 @md:prose-pre:mx-0 wrap-break-word",
        className,
      )}
    >
      {children}
    </div>
  );
};
