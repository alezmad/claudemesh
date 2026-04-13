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
  searchParams: Promise<{ code?: string; session?: string; port?: string }>;
}) {
  const { user } = await getSession();
  const { code, session, port } = await searchParams;

  // New 3-token flow: ?session=clm_sess_... (session_id in URL)
  // Legacy flow: ?code=ABCD-EFGH (user_code in URL)
  const sessionId = session ?? (code && code.startsWith("clm_sess_") ? code : null);
  const isDeviceCode = sessionId || (code && code.includes("-") && !port);
  const approvalCode = sessionId ?? code;

  if (isDeviceCode && approvalCode) {
    if (!user) {
      return (
        <main className="min-h-screen bg-[var(--cm-bg,#0a0a0a)] text-[var(--cm-fg,#fafafa)] antialiased flex items-center justify-center">
          <CliAuthLogin code={approvalCode} />
        </main>
      );
    }

    return (
      <main className="min-h-screen bg-[var(--cm-bg,#0a0a0a)] text-[var(--cm-fg,#fafafa)] antialiased flex items-center justify-center">
        <DeviceCodeApproval
          code={approvalCode}
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
