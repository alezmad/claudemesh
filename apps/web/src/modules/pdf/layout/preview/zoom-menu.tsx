import { usePdf } from "@anaralabs/lector";

import { useTranslation } from "@turbostarter/i18n";
import { Button } from "@turbostarter/ui-web/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@turbostarter/ui-web/dropdown-menu";
import { Icons } from "@turbostarter/ui-web/icons";

export const ZoomMenu = () => {
  const { t } = useTranslation("ai");
  const zoom = usePdf((state) => state.zoom);
  const setCustomZoom = usePdf((state) => state.updateZoom);
  const fitToWidth = usePdf((state) => state.zoomFitWidth);

  const handleZoomDecrease = () => setCustomZoom((zoom) => zoom * 0.9);
  const handleZoomIncrease = () => setCustomZoom((zoom) => zoom * 1.1);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1"
          aria-label={t("pdf.preview.zoom.options")}
        >
          {Math.round(zoom * 100)}%
          <Icons.ChevronUp className="text-muted-foreground h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem className="flex justify-between">
          <span>{`${Math.round(zoom * 100)}%`}</span>
        </DropdownMenuItem>

        <Button
          variant="ghost"
          onClick={handleZoomDecrease}
          size="icon"
          aria-label={t("pdf.preview.zoom.out")}
        >
          <Icons.MinusIcon className="size-4" />
        </Button>

        <Button
          variant="ghost"
          onClick={handleZoomIncrease}
          size="icon"
          aria-label={t("pdf.preview.zoom.in")}
        >
          <Icons.PlusIcon className="size-4" />
        </Button>

        <DropdownMenuItem onSelect={() => fitToWidth()}>
          {t("pdf.preview.zoom.fit")}
        </DropdownMenuItem>

        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((zoomLevel) => (
          <DropdownMenuItem
            key={zoomLevel}
            onSelect={() => setCustomZoom(zoomLevel)}
          >
            {`${zoomLevel * 100}%`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
