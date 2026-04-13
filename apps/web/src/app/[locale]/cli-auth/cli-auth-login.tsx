"use client";

import { SocialProvider } from "@turbostarter/auth";

import { authConfig } from "~/config/auth";
import { SocialProviders } from "~/modules/auth/form/social-providers";
import { RegisterForm } from "~/modules/auth/form/register-form";
import { AuthDivider } from "~/modules/auth/layout/divider";

interface Props {
  code: string;
}

export function CliAuthLogin({ code }: Props) {
  const redirectTo = `/cli-auth?code=${encodeURIComponent(code)}`;

  return (
    <div className="w-full max-w-md space-y-8 p-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div
          className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
          style={{ background: "var(--cm-accent, #f97316)", color: "#000" }}
        >
          cm
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Connect to claudemesh CLI
        </h1>
        <p className="text-sm" style={{ color: "var(--cm-fg-muted, #888)" }}>
          Sign in or create an account to connect your terminal session.
        </p>
      </div>

      {/* Social providers */}
      <SocialProviders
        providers={authConfig.providers.oAuth as SocialProvider[]}
        redirectTo={redirectTo}
      />

      <AuthDivider />

      {/* Email + password form */}
      <RegisterForm redirectTo={redirectTo} />

      {/* Device code footer */}
      <div className="pt-2 text-center">
        <div
          className="inline-block rounded-lg px-4 py-2 font-mono text-sm tracking-widest"
          style={{ background: "var(--cm-bg-muted, #1a1a1a)", color: "var(--cm-fg-muted, #888)" }}
        >
          {code}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--cm-fg-muted, #666)" }}>
          Confirm this code matches your terminal
        </p>
      </div>
    </div>
  );
}
