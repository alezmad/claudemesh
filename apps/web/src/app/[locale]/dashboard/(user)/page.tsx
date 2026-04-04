"use client";

import { useTranslation } from "@turbostarter/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@turbostarter/ui-web/card";
import { Icons } from "@turbostarter/ui-web/icons";

/**
 * Dashboard Home Page
 *
 * Welcome page for authenticated users.
 */
export default function DashboardPage() {
  const { t } = useTranslation("dashboard");

  return (
    <div className="@container h-full p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("welcome.title", { defaultValue: "Welcome to your Dashboard" })}
          </h1>
          <p className="text-muted-foreground">
            {t("welcome.description", { defaultValue: "Get started by exploring the features below." })}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("features.aiChat.title", { defaultValue: "AI Chat" })}</CardTitle>
              <Icons.MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("features.aiChat.description", { defaultValue: "Have a conversation with AI assistants" })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("features.imageGeneration.title", { defaultValue: "Image Generation" })}</CardTitle>
              <Icons.Image className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("features.imageGeneration.description", { defaultValue: "Create images with AI" })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("features.pdfAnalysis.title", { defaultValue: "PDF Analysis" })}</CardTitle>
              <Icons.FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("features.pdfAnalysis.description", { defaultValue: "Upload and analyze PDF documents" })}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
