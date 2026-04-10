import { notFound, redirect } from "next/navigation";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";

export const generateMetadata = getMetadata({
  title: "Join a mesh",
  description: "You've been invited to a claudemesh mesh.",
});

/**
 * Short invite URL: /i/{code}
 *
 * Resolves the short code to the canonical long token server-side and
 * redirects to `/join/[token]`. Keeps the rest of the join UX in a single
 * place and leaves the broker protocol untouched.
 *
 * This is a URL shortener, NOT a security boundary — the long token still
 * carries the mesh root_key. See the v2 invite protocol spec:
 *   .artifacts/specs/2026-04-10-anthropic-vision-meshes-invites.md
 */
export default async function ShortInvitePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;

  // Hit the public resolver. Returns {found, token} or 404.
  const res = await api.public["invite-code"][":code"]
    .$get({ param: { code } })
    .catch(() => null);

  if (!res || !res.ok) {
    notFound();
  }

  const body = (await res.json()) as
    | { found: true; token: string }
    | { found: false };

  if (!body.found) {
    notFound();
  }

  // next/navigation `redirect` throws — no need to return anything after.
  redirect(`/${locale}/join/${body.token}`);
}
