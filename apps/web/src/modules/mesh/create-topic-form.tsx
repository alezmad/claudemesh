"use client";

import { useState, useTransition } from "react";

import { Button } from "@turbostarter/ui-web/button";
import { Input } from "@turbostarter/ui-web/input";

import { createTopic } from "./topic-actions";

const monoStyle = { fontFamily: "var(--cm-font-mono)" } as const;

interface Props {
  meshId: string;
  /** "inline" — sits inside the empty-state card. "compact" — header pill. */
  variant?: "inline" | "compact";
}

export function CreateTopicForm({ meshId, variant = "inline" }: Props) {
  const [open, setOpen] = useState(variant === "inline");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (variant === "compact" && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--cm-border)] bg-transparent px-2.5 py-1 font-mono text-[11px] tracking-[0.04em] text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-border-hover)] hover:text-[var(--cm-clay)]"
      >
        <span className="text-[var(--cm-clay)]">+</span> new topic
      </button>
    );
  }

  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          try {
            await createTopic(meshId, fd);
          } catch (e) {
            setError((e as Error).message);
          }
        });
      }}
      className={
        variant === "inline"
          ? "flex flex-col gap-3"
          : "flex flex-col gap-3 rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)]/40 p-4"
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="relative flex-1">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cm-clay)]"
            style={monoStyle}
          >
            #
          </span>
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="deploys"
            autoComplete="off"
            spellCheck={false}
            required
            className="pl-7 font-mono"
            disabled={pending}
          />
        </div>
        <Input
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="what's this topic for? (optional)"
          autoComplete="off"
          className="flex-[2]"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "creating…" : "create"}
        </Button>
        {variant === "compact" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setName("");
              setDescription("");
              setError(null);
            }}
          >
            cancel
          </Button>
        ) : null}
      </div>
      {error ? (
        <p
          className="text-[10px] text-[#c46686]"
          style={monoStyle}
        >
          error · {error}
        </p>
      ) : (
        <p
          className="text-[10px] text-[var(--cm-fg-tertiary)]"
          style={monoStyle}
        >
          name · lowercase, digits, dashes only · 1–50 chars
        </p>
      )}
    </form>
  );
}
