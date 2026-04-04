"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  createMyMeshInputSchema,
  type CreateMyMeshInput,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormControl,
  FormDescription,
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

import { pathsConfig } from "~/config/paths";
import { api } from "~/lib/api/client";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const CreateMeshForm = ({
  onboarding = false,
}: { onboarding?: boolean } = {}) => {
  const router = useRouter();
  const form = useForm<CreateMyMeshInput>({
    resolver: zodResolver(createMyMeshInputSchema),
    defaultValues: {
      name: "",
      slug: "",
      visibility: "private",
      transport: "managed",
    },
  });

  const nameValue = form.watch("name");
  const slugDirty = form.formState.dirtyFields.slug;

  useEffect(() => {
    if (!slugDirty && nameValue) {
      form.setValue("slug", slugify(nameValue));
    }
  }, [nameValue, slugDirty, form]);

  const onSubmit = async (values: CreateMyMeshInput) => {
    try {
      const res = (await handle(api.my.meshes.$post)({
        json: values,
      })) as { id: string; slug: string } | { error: string };
      if ("error" in res) {
        form.setError("slug", { message: res.error });
        return;
      }
      router.push(
        onboarding
          ? `${pathsConfig.dashboard.user.meshes.invite(res.id)}?onboarding=1`
          : pathsConfig.dashboard.user.meshes.mesh(res.id),
      );
    } catch (e) {
      form.setError("root", {
        message: e instanceof Error ? e.message : "Failed to create mesh.",
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Platform team" {...field} />
              </FormControl>
              <FormDescription>
                Display name — what teammates see.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug</FormLabel>
              <FormControl>
                <Input placeholder="platform-team" {...field} />
              </FormControl>
              <FormDescription>
                URL-safe identifier: lowercase letters, digits, hyphens.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="visibility"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Visibility</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="private">
                    Private — invite-only
                  </SelectItem>
                  <SelectItem value="public">
                    Public — anyone with the link
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="transport"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Transport</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="managed">Managed (claudemesh.com)</SelectItem>
                  <SelectItem value="tailscale">Tailscale</SelectItem>
                  <SelectItem value="self_hosted">Self-hosted broker</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                How peers reach the broker.
              </FormDescription>
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
          {form.formState.isSubmitting ? "Creating…" : "Create mesh"}
        </Button>
      </form>
    </Form>
  );
};
