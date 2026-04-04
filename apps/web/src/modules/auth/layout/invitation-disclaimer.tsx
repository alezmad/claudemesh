"use client";

import { useTranslation } from "@turbostarter/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@turbostarter/ui-web/alert";
import { Icons } from "@turbostarter/ui-web/icons";

export const InvitationDisclaimer = () => {
  const { t } = useTranslation("organization");

  return (
    <Alert variant="primary">
      <Icons.MailPlus />
      <AlertTitle>{t("invitations.disclaimer.title")}</AlertTitle>
      <AlertDescription>
        {t("invitations.disclaimer.description")}
      </AlertDescription>
    </Alert>
  );
};
