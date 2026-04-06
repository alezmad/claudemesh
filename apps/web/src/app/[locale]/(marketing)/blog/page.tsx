import Link from "next/link";
import { getPayload } from "payload";
import config from "@payload-config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Blog — claudemesh",
  description: "Engineering notes on peer messaging, protocol design, and multi-agent security.",
};

export default async function BlogIndex() {
  const payload = await getPayload({ config });
  const { docs: posts } = await payload.find({
    collection: "posts",
    where: { status: { equals: "published" } },
    sort: "-publishedAt",
    limit: 20,
    depth: 1,
  });

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
        {posts.length === 0 && (
          <p className="text-sm text-[var(--cm-fg-tertiary)]" style={{ fontFamily: "var(--cm-font-mono)" }}>
            No posts yet. First one ships soon.
          </p>
        )}
        {posts.map((post: any) => (
          <article key={post.id} className="border-b border-[var(--cm-border)] pb-8">
            <time
              dateTime={post.publishedAt}
              className="text-[11px] uppercase tracking-wider text-[var(--cm-fg-tertiary)]"
              style={{ fontFamily: "var(--cm-font-mono)" }}
            >
              {post.publishedAt
                ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "Draft"}
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
            {post.excerpt && (
              <p
                className="mt-3 text-[14px] leading-[1.6] text-[var(--cm-fg-secondary)]"
                style={{ fontFamily: "var(--cm-font-sans)" }}
              >
                {post.excerpt}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
