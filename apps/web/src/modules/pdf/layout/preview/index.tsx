"use client";

import {
  CanvasLayer,
  Page,
  Pages,
  Root,
  TextLayer,
  usePdf,
  usePdfJump,
} from "@anaralabs/lector";
import { GlobalWorkerOptions } from "pdfjs-dist";
import React, { memo, useEffect } from "react";

import { Skeleton } from "@turbostarter/ui-web/skeleton";

import { usePdfViewer } from "../../context";

import { DocumentMenu } from "./document-menu";
import { HighlightLayer } from "./highlight-layer";
import { PageNavigation } from "./page-navigation";
import "./pdf-viewer.css";
import { TextHighlightLayer } from "./text-highlight-layer";
import { ZoomMenu } from "./zoom-menu";

// Import extracted PDF text layer styles (avoids problematic pdfjs-dist CSS with relative image imports)

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

interface PdfPreviewProps {
  readonly url: string;
}

/**
 * Syncs lector's current page with our PdfViewerContext.
 * Also handles navigation requests from citations.
 * Must be rendered inside lector's Root provider.
 */
const PageSync = () => {
  const lectorPage = usePdf((state) => state.currentPage);
  const { setCurrentPage, pendingNavigation, clearPendingNavigation } =
    usePdfViewer();
  const { jumpToPage } = usePdfJump();

  // Sync lector page changes to our context (user scrolling)
  useEffect(() => {
    setCurrentPage(lectorPage);
  }, [lectorPage, setCurrentPage]);

  // Handle navigation requests from citations
  useEffect(() => {
    if (pendingNavigation) {
      const behavior = pendingNavigation.animate ? "smooth" : "auto";
      jumpToPage(pendingNavigation.page, { behavior });
      clearPendingNavigation();
    }
  }, [pendingNavigation, jumpToPage, clearPendingNavigation]);

  return null;
};

export const PdfPreview = memo<PdfPreviewProps>(({ url }) => {
  return (
    <Root
      className="flex h-full w-full flex-col overflow-hidden"
      source={url}
      isZoomFitWidth={true}
      loader={<Skeleton className="h-full w-full" />}
    >
      <PageSync />
      <div className="relative flex justify-between border-b p-1">
        <ZoomMenu />
        <PageNavigation />
        <DocumentMenu documentUrl={url} />
      </div>
      <div className="relative flex-1 overflow-hidden">
        <HighlightLayer />
        <TextHighlightLayer />
        <Pages className="dark:brightness-80 dark:contrast-228 dark:hue-rotate-180 dark:invert-94">
          <Page>
            <CanvasLayer />
            <TextLayer />
          </Page>
        </Pages>
      </div>
    </Root>
  );
});

PdfPreview.displayName = "PdfPreview";
