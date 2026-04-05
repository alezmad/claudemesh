"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import QRCode from "qrcode";

import {
  createMyInviteInputSchema,
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
  token: string;
  inviteLink: string;
  joinUrl: string;
  expiresAt: Date;
  qrDataUrl: string;
}

export const InviteGenerator = ({ meshId }: { meshId: string }) => {
  const [result, setResult] = useState<GeneratedInvite | null>(null);
  const [copied, setCopied] = useState<"url" | "cli" | null>(null);

  const form = useForm<CreateMyInviteInput>({
    resolver: zodResolver(createMyInviteInputSchema),
    defaultValues: { role: "member", maxUses: 1, expiresInDays: 7 },
  });

  const onSubmit = async (values: CreateMyInviteInput) => {
    try {
      const res = (await handle(api.my.meshes[":id"].invites.$post)({
        param: { id: meshId },
        json: values,
      })) as
        | {
            id: string;
            token: string;
            inviteLink: string;
            joinUrl: string;
            expiresAt: string;
          }
        | { error: string };

      if ("error" in res) {
        form.setError("root", { message: res.error });
        return;
      }

      // QR encodes the HTTPS join URL now — anyone with a camera can
      // scan and land on the friendly /join/[token] page.
      const qrDataUrl = await QRCode.toDataURL(res.joinUrl, {
        width: 256,
        margin: 1,
        color: { dark: "#141413", light: "#ffffff" },
      });

      setResult({
        id: res.id,
        token: res.token,
        inviteLink: res.inviteLink,
        joinUrl: res.joinUrl,
        expiresAt: new Date(res.expiresAt),
        qrDataUrl,
      });
    } catch (e) {
      form.setError("root", {
        message: e instanceof Error ? e.message : "Failed to generate invite.",
      });
    }
  };

  const copy = async (text: string, key: "url" | "cli") => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (result) {
    const cliCmd = `claudemesh join ${result.token}`;
    return (
      <div className="space-y-6">
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
                  {result.joinUrl}
                </code>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <Badge variant="outline">
                  expires {result.expiresAt.toLocaleDateString()}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => copy(result.joinUrl, "url")} size="sm">
                  {copied === "url" ? "Copied ✓" : "Copy link"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(cliCmd, "cli")}
                >
                  {copied === "cli" ? "Copied ✓" : "Copy CLI command"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResult(null);
                    form.reset();
                  }}
                >
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-5">
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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
          control={form.control}
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
          control={form.control}
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
        {form.formState.errors.root && (
          <p className="text-destructive text-sm">
            {form.formState.errors.root.message}
          </p>
        )}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Generating…" : "Generate invite"}
        </Button>
      </form>
    </Form>
  );
};
