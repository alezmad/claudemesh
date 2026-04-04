import * as Slot from "@rn-primitives/slot";
import { cva } from "class-variance-authority";
import { View } from "react-native";

import { cn } from "@turbostarter/ui";

import { TextClassContext } from "./text";

import type { VariantProps } from "class-variance-authority";
import type { ViewProps } from "react-native";

const badgeVariants = cva(
  "border-border group shrink-0 flex-row items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5",
  {
    variants: {
      variant: {
        default: "bg-primary border-transparent active:opacity-80",
        secondary: "bg-secondary border-transparent active:opacity-80",
        destructive: "bg-destructive border-transparent active:opacity-80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const badgeTextVariants = cva("font-sans-medium text-xs", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type BadgeProps = ViewProps &
  React.RefAttributes<View> & {
    asChild?: boolean;
  } & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, asChild, ...props }: BadgeProps) {
  const Component = asChild ? Slot.View : View;
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <Component
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Badge, badgeTextVariants, badgeVariants };
export type { BadgeProps };
