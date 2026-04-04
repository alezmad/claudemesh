import { usePdf } from "@anaralabs/lector";
import { useState } from "react";
import { toast } from "sonner";

import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@turbostarter/ui-web/dropdown-menu";
import { Icons } from "@turbostarter/ui-web/icons";

interface DocumentMenuProps {
  readonly documentUrl: string;
}

export const DocumentMenu = ({ documentUrl }: DocumentMenuProps) => {
  const { t } = useTranslation("common");
  const [isDownloading, setIsDownloading] = useState(false);
  const pdfDocumentProxy = usePdf((state) => state.pdfDocumentProxy);

  const handleDownload = async () => {
    if (isDownloading) return;

    try {
      setIsDownloading(true);

      const pdfData = await pdfDocumentProxy.getData();
      const blob = new Blob([pdfData as BlobPart], { type: "application/pdf" });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const filename = documentUrl.split("/").pop() ?? "document.pdf";
      link.download = filename;

      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      toast.error(t("error.general"));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenClick = () => {
    window.open(documentUrl, "_blank");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Icons.Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          onClick={handleDownload}
          disabled={isDownloading || !pdfDocumentProxy}
          className="gap-2"
        >
          <Icons.DownloadCloud className="size-4" />
          {isDownloading ? t("downloading") : t("download")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleOpenClick} className="gap-2">
          <Icons.Link className="size-4" /> {t("open")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DocumentMenu;
