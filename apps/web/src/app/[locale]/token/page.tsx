import { redirect } from "next/navigation";
import { getSession } from "~/lib/auth/server";
import { getMetadata } from "~/lib/metadata";
import { TokenGenerator } from "./token-generator";

export const generateMetadata = getMetadata({
  title: "CLI Token",
  description: "Generate a token to sign in to claudemesh CLI.",
});

export default async function TokenPage() {
  const { user } = await getSession();

  if (!user) {
    return redirect(`/auth/login?redirectTo=${encodeURIComponent("/token")}`);
  }

  return (
    <main className="min-h-screen bg-[var(--cm-bg,#0a0a0a)] text-[var(--cm-fg,#fafafa)] antialiased flex items-center justify-center">
      <TokenGenerator
        userId={user.id}
        userEmail={user.email}
        userName={user.name ?? user.email}
      />
    </main>
  );
}
