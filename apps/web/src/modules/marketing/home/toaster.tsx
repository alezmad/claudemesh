"use client";
import { useState } from "react";
import Link from "next/link";

const NEWS = [
  {
    tag: "New",
    title: "claudemesh launch (v0.1.2)",
    body: "Real-time peer messages pushed into Claude Code mid-turn. One command. Source open at github.com/alezmad/claudemesh-cli.",
    href: "https://github.com/alezmad/claudemesh-cli",
  },
  {
    tag: "Beta",
    title: "Mesh Dashboard",
    body: "Watch every Claude Code session on your team. Routes, presence, priority — all live.",
    href: "#",
  },
  {
    tag: "New",
    title: "MCP bridge",
    body: "Expose mesh messages as MCP tools. Your agent can message peers without leaving its context.",
    href: "#",
  },
  {
    tag: "Launch",
    title: "Self-hosted broker",
    body: "One binary. SQLite-backed. Runs on a Pi. Your mesh, never the cloud's.",
    href: "#",
  },
];

export const LatestNewsToaster = () => {
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const item = NEWS[index];
  if (!item) return null;
  return (
    <div
      className="fixed bottom-6 right-6 z-[100] hidden w-[384px] rounded-[12px] border border-[var(--cm-border)] bg-[var(--cm-bg)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)] md:block"
      role="complementary"
      aria-label="Latest news"
    >
      {/* head */}
      <div className="mb-4 flex items-center justify-between">
        <div
          className="flex items-center gap-1.5 text-xs text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-sans)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2C11.3137 2 14 4.68629 14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2ZM8 2.8C5.12812 2.8 2.8 5.12812 2.8 8C2.8 10.8719 5.12812 13.2 8 13.2C10.8719 13.2 13.2 10.8719 13.2 8C13.2 5.12812 10.8719 2.8 8 2.8ZM8.4 7.6V10H9.2C9.42091 10 9.6 10.1791 9.6 10.4C9.6 10.6209 9.42091 10.8 9.2 10.8H6.8C6.57909 10.8 6.4 10.6209 6.4 10.4C6.4 10.1791 6.57909 10 6.8 10H7.6V8H6.8C6.57909 8 6.4 7.82091 6.4 7.6C6.4 7.37909 6.57909 7.2 6.8 7.2H8C8.22091 7.2 8.4 7.37909 8.4 7.6ZM8 5.2C8.33137 5.2 8.6 5.46863 8.6 5.8C8.6 6.13137 8.33137 6.4 8 6.4C7.66863 6.4 7.4 6.13137 7.4 5.8C7.4 5.46863 7.66863 5.2 8 5.2Z"
              fill="currentColor"
            />
          </svg>
          Latest news
        </div>
        <button
          onClick={() => setHidden(true)}
          className="rounded p-1 text-[var(--cm-fg-tertiary)] transition-colors hover:bg-[var(--cm-bg-elevated)] hover:text-[var(--cm-fg)]"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <path
              d="M15.15 4.15a.5.5 0 01.7.7L10.71 10l5.14 5.15a.5.5 0 01-.7.7L10 10.71l-5.15 5.14a.5.5 0 01-.7-.7L9.29 10 4.15 4.85a.5.5 0 01.7-.7L10 9.29l5.15-5.14z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      {/* body */}
      <div className="grid grid-cols-[1fr_108px] gap-4">
        <div>
          <h4
            className="mb-2 text-[22px] font-medium leading-tight text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-serif)" }}
          >
            {item.title}
          </h4>
          <p
            className="mb-4 text-[12px] leading-[1.5] text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            {item.body}
          </p>
          <Link
            href={item.href}
            className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--cm-fg)] px-3 py-1.5 text-[12px] font-medium text-[var(--cm-bg)] transition-colors hover:bg-[var(--cm-gray-150)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            Learn more
          </Link>
        </div>
        {/* illustration tile */}
        <div className="flex h-[108px] w-[108px] items-center justify-center rounded-[8px] bg-[var(--cm-clay)]">
          <svg width="68" height="68" viewBox="0 0 68 68" fill="none">
            <circle cx="20" cy="20" r="4" fill="#141413" />
            <circle cx="48" cy="16" r="4" fill="#141413" />
            <circle cx="52" cy="40" r="4" fill="#141413" />
            <circle cx="24" cy="44" r="4" fill="#141413" />
            <path
              d="M20 20L48 16L52 40L24 44L20 20z"
              stroke="#141413"
              strokeWidth="1.5"
              fill="none"
            />
            <path
              d="M10 56c6-4 12-4 20 0s14 4 24-2"
              stroke="#141413"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
      {/* pager */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--cm-border)] pt-3">
        <div
          className="text-[10px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          {String(index + 1).padStart(2, "0")} / {String(NEWS.length).padStart(2, "0")}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() =>
              setIndex((i) => (i - 1 + NEWS.length) % NEWS.length)
            }
            className="rounded border border-[var(--cm-border)] px-2 py-1 text-xs text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-fg)] hover:text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
            aria-label="Previous"
          >
            ←
          </button>
          <button
            onClick={() => setIndex((i) => (i + 1) % NEWS.length)}
            className="rounded border border-[var(--cm-border)] px-2 py-1 text-xs text-[var(--cm-fg-secondary)] transition-colors hover:border-[var(--cm-fg)] hover:text-[var(--cm-fg)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
            aria-label="Next"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
};
