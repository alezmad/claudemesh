import { cn } from "@turbostarter/ui";

import { Controls } from "./controls";

import type { UIMessage } from "@ai-sdk/react";

export type ThreadMessageComponents<MESSAGE extends UIMessage> = Record<
  string,
  React.ComponentType<ThreadMessageProps<MESSAGE>>
>;

export interface ThreadMessageProps<T extends UIMessage = UIMessage> {
  readonly status: string;
  readonly message: T;
  readonly ref?: React.RefObject<HTMLDivElement | null>;
}

const Message = <MESSAGE extends UIMessage>(
  props: ThreadMessageProps<MESSAGE> & {
    components: ThreadMessageComponents<MESSAGE>;
  },
) => {
  const role = props.message.role;

  const isSupportedRole = (
    role: string,
  ): role is keyof typeof props.components => {
    return role in props.components;
  };

  if (!isSupportedRole(role)) {
    return null;
  }

  const Component = props.components[role];

  if (!Component) {
    return null;
  }

  return <Component {...props} />;
};

const Layout = ({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) => {
  return (
    <div
      className={cn(
        "group relative mx-auto flex w-full max-w-3xl scroll-mb-[calc(var(--composer-height,140px)+36px)] flex-col justify-center gap-1 py-4 @md/thread:px-1 @lg/thread:px-2 @xl/thread:px-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const ThreadMessage = {
  Layout,
  Message,
  Controls,
};
