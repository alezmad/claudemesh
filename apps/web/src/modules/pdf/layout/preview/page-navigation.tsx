import { usePdf, usePdfJump } from "@anaralabs/lector";
import { useEffect, useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import { Icons } from "@turbostarter/ui-web/icons";

export const PageNavigation = () => {
  const { t } = useTranslation("ai");
  const pages = usePdf((state) => state.pdfDocumentProxy.numPages);
  const currentPage = usePdf((state) => state.currentPage);

  const [pageNumber, setPageNumber] = useState<string | number>(currentPage);
  const { jumpToPage } = usePdfJump();

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      jumpToPage(currentPage - 1, { behavior: "auto" });
    }
  };

  const handleNextPage = () => {
    if (currentPage < pages) {
      jumpToPage(currentPage + 1, { behavior: "auto" });
    }
  };

  useEffect(() => {
    setPageNumber(currentPage);
  }, [currentPage]);

  return (
    <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 transform flex-row items-center justify-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePreviousPage}
        disabled={currentPage <= 1}
        aria-label={t("pdf.preview.navigation.previous")}
        className="h-8 w-8"
      >
        <Icons.ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-1">
        <input
          type="number"
          value={pageNumber}
          onChange={(e) => setPageNumber(e.target.value)}
          onBlur={(e) => {
            if (currentPage !== Number(e.target.value)) {
              jumpToPage(Number(e.target.value), {
                behavior: "auto",
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="bg-accent focus:ring-primary/20 w-10 [appearance:textfield] rounded-md border-none text-center text-sm font-medium focus:ring-2 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-muted-foreground text-sm font-medium">
          / {pages}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleNextPage}
        disabled={currentPage >= pages}
        aria-label={t("pdf.preview.navigation.next")}
        className="h-8 w-8"
      >
        <Icons.ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};
