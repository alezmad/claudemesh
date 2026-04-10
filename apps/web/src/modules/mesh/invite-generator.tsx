"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import QRCode from "qrcode";

import {
  createEmailInviteInputSchema,
  createMyInviteInputSchema,
  type CreateEmailInviteInput,
  type CreateMyInviteInput,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { Badge } from "@turbostarter/ui-web/badge";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@turbostarter/ui-web/form";
import { Input } from "@turbostarter/ui-web/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@turbostarter/ui-web/select";

import { api } from "~/lib/api/client";

interface GeneratedInvite {
  id: string;
  /** Raw token (only set for link-mode results — empty string when email mode). */
  token: string;
  /** Short code for the CLI command. Falls back to shortUrl display if null. */
  code: string | null;
  joinUrl: string;
  /** Short human-friendly URL, preferred for sharing. Null if the backend didn't mint one. */
  shortUrl: string | null;
  expiresAt: Date;
  qrDataUrl: string;
  /** When set, the invite was dispatched via email and a confirmation banner is shown. */
  sentToEmail?: string;
}

type Mode = "link" | "email";

const qrOptions = {
  width: 256,
  margin: 1,
  color: { dark: "#141413", light: "#ffffff" },
} as const;

export const InviteGenerator = ({ meshId }: { meshId: string }) => {
  const [mode, setMode] = useState<Mode>("link");
  const [result, setResult] = useState<GeneratedInvite | null>(null);
  const [copied, setCopied] = useState<"url" | "cli" | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Two separate forms — simpler than conditional validation, clearer state
  // boundaries, and each form owns its own submit + error surface.
  const linkForm = useForm<CreateMyInviteInput>({
    resolver: zodResolver(createMyInviteInputSchema),
    defaultValues: { role: "member", maxUses: 1, expiresInDays: 7 },
  });

  const emailForm = useForm<CreateEmailInviteInput>({
    resolver: zodResolver(createEmailInviteInputSchema),
    defaultValues: {
      email: "",
      role: "member",
      maxUses: 1,
      expiresInDays: 7,
    },
  });

  const activeForm = mode === "link" ? linkForm : emailForm;

  const onSubmitLink = async (values: CreateMyInviteInput) => {
    try {
      const res = (await handle(api.my.meshes[":id"].invites.$post)({
        param: { id: meshId },
        json: values,
      })) as {
        id: string;
        token: string;
        code: string | null;
        inviteLink: string;
        joinUrl: string;
        shortUrl: string | null;
        expiresAt: string;
      };

      // QR encodes the SHORT URL when available — scannable at camera distance
      // and short enough for the QR to stay low-density. Falls back to the
      // long token URL for legacy invites minted before the shortener shipped.
      const qrTarget = res.shortUrl ?? res.joinUrl;
      const qrDataUrl = await QRCode.toDataURL(qrTarget, qrOptions);

      setResult({
        id: res.id,
        token: res.token,
        code: res.code,
        joinUrl: res.joinUrl,
        shortUrl: res.shortUrl,
        expiresAt: new Date(res.expiresAt),
        qrDataUrl,
      });
    } catch (e) {
      linkForm.setError("root", {
        message: e instanceof Error ? e.message : "Failed to generate invite.",
      });
    }
  };

  const onSubmitEmail = async (values: CreateEmailInviteInput) => {
    try {
      // TODO(types): remove `as any` after RPC type regen picks up the new
      // `.email` subroute registered in packages/api/src/modules/mesh/router.ts.
      const res = (await handle(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api.my.meshes[":id"].invites as any).email.$post,
      )({
        param: { id: meshId },
        json: values,
      })) as {
        pendingInviteId: string;
        code: string;
        email: string;
        shortUrl: string;
        expiresAt: string;
      };

      const qrDataUrl = await QRCode.toDataURL(res.shortUrl, qrOptions);

      setResult({
        id: res.pendingInviteId,
        token: "",
        code: res.code,
        joinUrl: res.shortUrl,
        shortUrl: res.shortUrl,
        expiresAt: new Date(res.expiresAt),
        qrDataUrl,
        sentToEmail: res.email,
      });
    } catch (e) {
      emailForm.setError("root", {
        message: e instanceof Error ? e.message : "Failed to send invite.",
      });
    }
  };

  const copy = async (text: string, key: "url" | "cli") => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const resetAll = () => {
    setResult(null);
    linkForm.reset();
    emailForm.reset();
  };

  if (result) {
    // Prefer the short URL everywhere it exists. CLI command uses the code
    // when available (short, easy to paste); otherwise falls back to the
    // shortUrl, which the CLI also accepts as an argument.
    const primaryUrl = result.shortUrl ?? result.joinUrl;
    const cliArg = result.code ?? result.shortUrl ?? "";
    const cliCmd = `claudemesh join ${cliArg}`;
    return (
      <div className="space-y-6">
        {result.sentToEmail && (
          <div className="space-y-2">
            <div
              role="status"
              className="border-primary/30 bg-primary/5 text-foreground flex items-start gap-3 rounded-lg border p-4 text-sm"
            >
              <span aria-hidden="true" className="text-primary mt-0.5">
                ✓
              </span>
              <div>
                <p className="font-medium">
                  Invite sent to {result.sentToEmail}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Email delivery is stubbed in v0.1.x — the invite is valid.
                  Share the link directly if needed.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="rounded-lg border p-6">
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <div className="flex items-start justify-center">
              <img
                src={result.qrDataUrl}
                alt="Invite QR code"
                className="h-[220px] w-[220px] rounded border"
              />
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">
                  Share this link
                </div>
                <code className="bg-muted block break-all rounded p-3 font-mono text-xs">
                  {primaryUrl}
                </code>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <Badge variant="outline">
                  expires {result.expiresAt.toLocaleDateString()}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => copy(primaryUrl, "url")} size="sm">
                  {copied === "url" ? "Copied ✓" : "Copy link"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(cliCmd, "cli")}
                >
                  {copied === "cli" ? "Copied ✓" : "Copy CLI command"}
                </Button>
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Generate another
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="text-muted-foreground rounded border border-dashed p-4 text-xs">
          <p className="mb-2 font-medium">How your teammate joins:</p>
          <p className="mb-2">
            Paste the link in Slack / Telegram / email. They land on a page
            with step-by-step install, or run the CLI directly if they already
            have it:
          </p>
          <code className="bg-muted block rounded p-2 font-mono text-xs">
            {cliCmd}
          </code>
        </div>
      </div>
    );
  }

  const ModeToggle = () => (
    <div
      role="group"
      aria-label="Invite delivery mode"
      className="bg-muted inline-flex rounded-md p-1 text-sm"
    >
      <button
        type="button"
        aria-pressed={mode === "link"}
        onClick={() => setMode("link")}
        className={`focus-visible:ring-ring rounded px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 ${
          mode === "link"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Link
      </button>
      <button
        type="button"
        aria-pressed={mode === "email"}
        onClick={() => setMode("email")}
        className={`focus-visible:ring-ring rounded px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 ${
          mode === "email"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Email
      </button>
    </div>
  );

  // Advanced block is rendered against whichever form is active. Because the
  // two schemas share identical role/maxUses/expiresInDays shapes, the field
  // components are structurally the same — we just bind to the active form.
  const AdvancedBlock = () => (
    <div className="rounded-md border border-dashed">
      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-wider"
        aria-expanded={showAdvanced}
      >
        <span>Advanced</span>
        <span aria-hidden="true">{showAdvanced ? "−" : "+"}</span>
      </button>
      {showAdvanced && (
        <div className="space-y-4 border-t px-3 py-4">
          <FormField
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            control={activeForm.control as any}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            control={activeForm.control as any}
            name="maxUses"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max uses</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            control={activeForm.control as any}
            name="expiresInDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expires in (days)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-md space-y-5">
      <ModeToggle />

      {mode === "link" ? (
        <Form {...linkForm}>
          <form
            onSubmit={linkForm.handleSubmit(onSubmitLink)}
            className="space-y-5"
          >
            <p className="text-muted-foreground text-sm">
              One-time invite for a new member. Valid for 7 days.
            </p>

            <AdvancedBlock />

            {linkForm.formState.errors.root && (
              <p className="text-destructive text-sm">
                {linkForm.formState.errors.root.message}
              </p>
            )}
            <Button type="submit" disabled={linkForm.formState.isSubmitting}>
              {linkForm.formState.isSubmitting
                ? "Generating…"
                : "Generate invite"}
            </Button>
          </form>
        </Form>
      ) : (
        <Form {...emailForm}>
          <form
            onSubmit={emailForm.handleSubmit(onSubmitEmail)}
            className="space-y-5"
          >
            <p className="text-muted-foreground text-sm">
              Send a one-time invite directly to an email address. Valid for 7
              days.
            </p>

            <FormField
              control={emailForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="teammate@company.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <AdvancedBlock />

            {emailForm.formState.errors.root && (
              <p className="text-destructive text-sm">
                {emailForm.formState.errors.root.message}
              </p>
            )}
            <Button type="submit" disabled={emailForm.formState.isSubmitting}>
              {emailForm.formState.isSubmitting ? "Sending…" : "Send invite"}
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
};
