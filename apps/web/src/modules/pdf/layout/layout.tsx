"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { useBreakpoint } from "@turbostarter/ui-web";
import { Button } from "@turbostarter/ui-web/button";
import { Drawer, DrawerContent } from "@turbostarter/ui-web/drawer";
import { Icons } from "@turbostarter/ui-web/icons";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@turbostarter/ui-web/resizable";
import { Skeleton } from "@turbostarter/ui-web/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@turbostarter/ui-web/tooltip";

import { Header } from "~/modules/common/layout/header";
import { ThemeSwitcher } from "~/modules/common/theme";

import { PdfViewerProvider } from "../context";
import { ChatHistory } from "../history";
import { pdf } from "../lib/api";

import { PdfPreview } from "./preview";

const Trigger = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t } = useTranslation("ai");

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group relative"
            onClick={() => onOpenChange(!open)}
          >
            <Icons.FileText className="text-muted-foreground group-hover:text-foreground size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" sideOffset={5}>
          <span>{t("pdf.preview.toggle")}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const MobileDocumentPreview = ({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-b-none fixed right-0 bottom-0 left-0 mx-[-1px] flex max-h-[97%] flex-col gap-3 rounded-t-[10px] border px-3 pb-3">
        <Documents id={id} />
      </DrawerContent>
    </Drawer>
  );
};

const ProcessingIndicator = () => {
  const { t } = useTranslation("ai");

  return (
    <div className="bg-background/95 absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Icons.Loader2 className="text-primary size-6 animate-spin" />
        <span className="text-muted-foreground text-sm font-medium">
          {t("pdf.processing.indexing")}
        </span>
      </div>
      <p className="text-muted-foreground max-w-xs text-center text-xs">
        {t("pdf.processing.indexingDescription")}
      </p>
    </div>
  );
};

const Documents = ({ id }: { id: string }) => {
  const { t } = useTranslation("ai");

  const documents = useQuery(pdf.queries.chats.documents.getAll(id));
  const document = documents.data?.[0];

  // Poll for document processing status
  const status = useQuery({
    ...pdf.queries.chats.documents.getStatus(document?.id ?? ""),
    enabled: !!document?.id,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling once ready, failed, or error
      if (!data || "error" in data) {
        return false;
      }
      if (data.processingStatus === "ready" || data.processingStatus === "failed") {
        return false;
      }
      return 2000; // Poll every 2 seconds while processing
    },
  });

  const url = useQuery({
    ...pdf.queries.chats.documents.getUrl(document?.path ?? ""),
    enabled: !!document,
    staleTime: 1000 * 60 * 60,
  });

  if (documents.isLoading || url.isLoading) {
    return <Skeleton className="h-full w-full" />;
  }

  if (!url.data?.url) {
    return (
      <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-4 rounded-lg border p-6">
        <Icons.FileX className="size-12" />
        <p className="max-w-sm text-center">{t("pdf.preview.noDocuments")}</p>
      </div>
    );
  }

  // Check if still processing (not ready, not failed, not error)
  const statusData = status.data && !("error" in status.data) ? status.data : null;
  const isProcessing = statusData?.processingStatus !== "ready" &&
                       statusData?.processingStatus !== "failed";

  return (
    <div className="relative h-full w-full">
      <PdfPreview url={url.data.url} />
      {isProcessing && <ProcessingIndicator />}
    </div>
  );
};

export const PdfLayout = ({
  children,
  id,
}: {
  children: React.ReactNode;
  id: string;
}) => {
  const [open, setOpen] = useState(true);
  const isDesktop = useBreakpoint("lg");

  if (isDesktop) {
    return (
      <PdfViewerProvider>
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="relative flex h-full flex-col">
              <Header>
                <div className="flex items-center gap-1">
                  <ChatHistory />
                  <ThemeSwitcher />
                  <Trigger open={open} onOpenChange={setOpen} />
                </div>
              </Header>
              {children}
            </div>
          </ResizablePanel>

          {open && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={25}>
                <Documents id={id} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </PdfViewerProvider>
    );
  }

  return (
    <PdfViewerProvider>
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        <Header>
          <div className="flex items-center gap-1">
            <ChatHistory />
            <ThemeSwitcher />
            <Trigger open={open} onOpenChange={setOpen} />
          </div>
        </Header>
        {children}
        <MobileDocumentPreview open={open} onOpenChange={setOpen} id={id} />
      </div>
    </PdfViewerProvider>
  );
};
