import { notFound } from "next/navigation";
import { getPayload } from "payload";
import config from "@payload-config";
import { RichText } from "@payloadcms/richtext-lexical/react";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const payload = await getPayload({ config });
  const { docs } = await payload.find({
    collection: "posts",
    where: { slug: { equals: slug }, status: { equals: "published" } },
    limit: 1,
    depth: 1,
  });
  const post = docs[0];
  if (!post) return { title: "Not found — claudemesh" };
  return {
    title: `${post.title} — claudemesh`,
    description: post.excerpt || post.seo?.metaDescription || undefined,
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const payload = await getPayload({ config });
  const { docs } = await payload.find({
    collection: "posts",
    where: { slug: { equals: slug }, status: { equals: "published" } },
    limit: 1,
    depth: 2,
  });

  const post = docs[0] as any;
  if (!post) notFound();

  const author = typeof post.author === "object" ? post.author : null;

  return (
    <article className="mx-auto max-w-3xl px-6 py-24 md:py-32">
      <header className="mb-12">
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
        <h1
          className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-medium leading-[1.1] text-[var(--cm-fg)]"
          style={{ fontFamily: "var(--cm-font-serif)" }}
        >
          {post.title}
        </h1>
        {author && (
          <p
            className="mt-4 text-sm text-[var(--cm-fg-secondary)]"
            style={{ fontFamily: "var(--cm-font-sans)" }}
          >
            by {author.name}{author.role ? ` · ${author.role}` : ""}
          </p>
        )}
      </header>

      <div
        className="prose prose-invert max-w-none prose-headings:font-medium prose-a:text-[var(--cm-clay)] prose-a:no-underline hover:prose-a:underline prose-code:text-[var(--cm-fg-secondary)]"
        style={{ fontFamily: "var(--cm-font-serif)" }}
      >
        {post.content && <RichText data={post.content} />}
      </div>
    </article>
  );
}
