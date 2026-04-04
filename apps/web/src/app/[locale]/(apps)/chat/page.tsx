"use client";

import { useMemo } from "react";

import { generateId } from "@turbostarter/shared/utils";

import { useComposer } from "~/modules/chat/composer/hooks/use-composer";
import { NewChat } from "~/modules/chat/layout/new";
import { ViewChat } from "~/modules/chat/layout/view";

export default function Chat() {
  const id = useMemo(() => generateId(), []);

  const { messages } = useComposer({
    id,
  });

  if (messages.length) {
    return <ViewChat id={id} />;
  }

  return <NewChat id={id} />;
}
