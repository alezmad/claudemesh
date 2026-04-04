/* eslint-disable i18next/no-literal-string */
"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@turbostarter/ui-web/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@turbostarter/ui-web/dialog";
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
import { Textarea } from "@turbostarter/ui-web/textarea";


import { api } from "~/lib/api/client";

const formSchema = z.object({
  action: z.enum(["set", "add", "deduct"]),
  amount: z.coerce.number().int().positive("Amount must be positive"),
  reason: z.string().max(500).optional(),
});

interface CreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: {
    id: string;
    credits: number;
    user?: { name: string | null } | null;
  };
}

export function CreditsDialog({
  open,
  onOpenChange,
  customer,
}: CreditsDialogProps) {
  const queryClient = useQueryClient();

  const form = useForm({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      action: "add" as const,
      amount: 100,
      reason: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: z.output<typeof formSchema>) => {
      const res = await api.admin.customers[":id"].credits.$patch({
        param: { id: customer.id },
        json: data,
      });
      if (!res.ok) throw new Error("Failed to update credits");
      return res.json();
    },
    onSuccess: (result) => {
      toast.success(
        `Credits updated: ${result.previousBalance} → ${result.newBalance}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "customers"] });
      onOpenChange(false);
      form.reset();
    },
    onError: () => {
      toast.error("Failed to update credits");
    },
  });

  const watchAction = form.watch("action");
  const watchAmount = form.watch("amount");

  const previewBalance = () => {
    const amount = Number(watchAmount) || 0;
    switch (watchAction) {
      case "set":
        return amount;
      case "add":
        return customer.credits + amount;
      case "deduct":
        return Math.max(0, customer.credits - amount);
    }
  };

  const handleSubmit = (values: z.output<typeof formSchema>) => {
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Credits</DialogTitle>
          <DialogDescription>
            {customer.user?.name ?? "Customer"} - Current balance:{" "}
            <strong>{customer.credits}</strong>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(handleSubmit)(e);
            }}
          >
            <div className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="action"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Action</FormLabel>
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
                        <SelectItem value="add">Add credits</SelectItem>
                        <SelectItem value="deduct">Deduct credits</SelectItem>
                        <SelectItem value="set">Set to exact amount</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        placeholder="100"
                        {...field}
                        value={field.value as number}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Support credit, promo, etc."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="text-muted-foreground">New balance: </span>
                <strong>{previewBalance()}</strong>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Updating..." : "Update Credits"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
