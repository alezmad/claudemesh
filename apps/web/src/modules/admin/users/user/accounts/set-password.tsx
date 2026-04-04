import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { passwordSchema } from "@turbostarter/auth";
import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@turbostarter/ui-web/form";
import { Icons } from "@turbostarter/ui-web/icons";
import { PasswordInput } from "@turbostarter/ui-web/input";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalClose,
  ModalTrigger,
} from "@turbostarter/ui-web/modal";

import { admin } from "~/modules/admin/lib/api";

interface SetPasswordModalProps {
  readonly id: string;
  readonly children: React.ReactNode;
}

export const SetPasswordModal = ({ id, children }: SetPasswordModalProps) => {
  const { t } = useTranslation(["common", "auth", "admin"]);
  const [open, setOpen] = useState(false);

  const { data: user } = useQuery(admin.queries.users.get({ id }));

  const form = useForm({
    resolver: standardSchemaResolver(passwordSchema),
  });

  const setPassword = useMutation({
    ...admin.mutations.users.setPassword,
    onSuccess: () => {
      toast.success(t("users.user.accounts.password.update.success"));
      setOpen(false);
      form.reset();
    },
  });

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {t("users.user.accounts.password.update.title", {
              name: user?.name,
            })}
          </ModalTitle>
          <ModalDescription>
            {t("users.user.accounts.password.update.description")}
          </ModalDescription>
        </ModalHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              setPassword.mutateAsync({
                userId: id,
                newPassword: data.password,
              }),
            )}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem className="px-4 md:px-0">
                  <FormLabel>{t("newPassword")}</FormLabel>
                  <FormControl>
                    <PasswordInput {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("users.user.accounts.password.update.info")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <ModalFooter>
              <ModalClose asChild>
                <Button variant="outline" type="button">
                  {t("cancel")}
                </Button>
              </ModalClose>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Icons.Loader2 className="animate-spin" />
                ) : (
                  t("update")
                )}
              </Button>
            </ModalFooter>
          </form>
        </Form>
      </ModalContent>
    </Modal>
  );
};
