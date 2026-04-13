import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";

import { CliAuthFlow } from "./cli-auth-flow";
import { DeviceCodeApproval } from "./device-code-approval";
import { CliAuthLogin } from "./cli-auth-login";

export const generateMetadata = getMetadata({
  title: "Connect CLI",
  description: "Sign in to connect your claudemesh CLI.",
});

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; port?: string }>;
}) {
  const { user } = await getSession();
  const { code, port } = await searchParams;

  // Device-code flow: code contains "-" (e.g. "ABCD-EFGH"), no port
  const isDeviceCode = code && code.includes("-") && !port;

  if (isDeviceCode) {
    if (!user) {
      // NOT logged in → show inline auth form with device code context
      return (
        <main className="min-h-screen bg-[var(--cm-bg,#0a0a0a)] text-[var(--cm-fg,#fafafa)] antialiased flex items-center justify-center">
          <CliAuthLogin code={code} />
        </main>
      );
    }

    // Logged in → auto-approve
    return (
      <main className="min-h-screen bg-[var(--cm-bg,#0a0a0a)] text-[var(--cm-fg,#fafafa)] antialiased flex items-center justify-center">
        <DeviceCodeApproval
          code={code}
          userName={user.name ?? user.email}
        />
      </main>
    );
  }

  // Legacy callback flow (port-based)
  if (!user) {
    const { redirect } = await import("next/navigation");
    const qs = new URLSearchParams();
    if (code) qs.set("code", code);
    if (port) qs.set("port", port);
    const returnTo = `/cli-auth${qs.size ? `?${qs}` : ""}`;
    return redirect(`/auth/login?redirectTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <main
      className="min-h-screen bg-[var(--cm-bg,#0a0a0a)] text-[var(--cm-fg,#fafafa)] antialiased"
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
