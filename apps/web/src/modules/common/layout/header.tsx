import { cn } from "@turbostarter/ui";
import { SidebarTrigger } from "@turbostarter/ui-web/sidebar";

export const Header = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <header
      className={cn(
        "bg-background absolute top-0 left-0 z-20 flex h-12 w-full items-center justify-between gap-1 p-2 md:h-14 md:rounded-t-lg md:p-3",
        className,
      )}
    >
      <SidebarTrigger />
      {children}
    </header>
  );
};
