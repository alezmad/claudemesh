import { redirect } from "next/navigation";

import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";

import { CliAuthFlow } from "./cli-auth-flow";

export const generateMetadata = getMetadata({
  title: "Sync with CLI",
  description: "Link your claudemesh CLI to your account.",
});

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; port?: string }>;
}) {
  const { user } = await getSession();

  if (!user) {
    const sp = await searchParams;
    const qs = new URLSearchParams();
    if (sp.code) qs.set("code", sp.code);
    if (sp.port) qs.set("port", sp.port);
    const returnTo = `/cli-auth${qs.size ? `?${qs}` : ""}`;
    return redirect(`/auth/login?redirectTo=${encodeURIComponent(returnTo)}`);
  }

  const { code, port } = await searchParams;

  return (
    <main
      className="min-h-screen bg-[var(--cm-bg)] text-[var(--cm-fg)] antialiased"
      style={{ fontFamily: "var(--cm-font-sans)" }}
    >
      <CliAuthFlow
        code={code ?? null}
        port={port ?? null}
        userId={user.id}
        userEmail={user.email}
      />
    </main>
  );
}
