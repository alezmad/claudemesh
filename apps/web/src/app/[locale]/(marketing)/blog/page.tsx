import Link from "next/link";

export const metadata = {
  title: "Blog — claudemesh",
  description: "Engineering notes on peer messaging, protocol design, and multi-agent security.",
};

const POSTS = [
  {
    slug: "peer-messaging-claude-code",
    title: "Peer messaging for Claude Code: protocol, security, UX",
    excerpt:
      "How claudemesh connects Claude Code sessions over an encrypted mesh, using MCP dev-channels for real-time message injection.",
    date: "2026-04-06",
  },
];

export default function BlogIndex() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24 md:py-32">
      <h1
        className="text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        Blog
      </h1>
      <p
        className="mt-4 text-[15px] text-[var(--cm-fg-secondary)]"
        style={{ fontFamily: "var(--cm-font-sans)" }}
      >
        Engineering notes on protocol design, security, and multi-agent UX.
      </p>

      <div className="mt-12 space-y-10">
        {POSTS.map((post) => (
          <article key={post.slug} className="border-b border-[var(--cm-border)] pb-8">
            <time
              dateTime={post.date}
              className="text-[11px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {new Date(post.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
            <h2 className="mt-2">
              <Link
                href={`/blog/${post.slug}`}
                className="text-[22px] font-medium leading-tight text-[var(--cm-fg)] transition-colors hover:text-[var(--cm-clay)]"
                style={{ fontFamily: "var(--cm-font-serif)" }}
              >
                {post.title}
              </Link>
            </h2>
            <p
              className="mt-3 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
              style={{ fontFamily: "var(--cm-font-sans)" }}
            >
              {post.excerpt}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
