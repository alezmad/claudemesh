/* eslint-disable i18next/no-literal-string */
"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@turbostarter/ui-web/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@turbostarter/ui-web/alert-dialog";
import { Icons } from "@turbostarter/ui-web/icons";

interface ImpactItem {
  id: string;
  displayName: string;
}

interface CascadeImpact {
  label: string;
  count: number;
  items: ImpactItem[];
  hasMore: boolean;
}

interface DestructiveActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impacts: CascadeImpact[];
  isLoading?: boolean;
  isExecuting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}

export function DestructiveActionDialog({
  open,
  onOpenChange,
  title,
  description,
  impacts,
  isLoading = false,
  isExecuting = false,
  onConfirm,
  onCancel,
  confirmLabel = "Delete",
}: DestructiveActionDialogProps) {
  const hasImpacts = impacts.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icons.Loader2 className="h-4 w-4 animate-spin" />
            Checking impact...
          </div>
        ) : hasImpacts ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex items-start gap-2">
              <Icons.AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-destructive">
                  This will also delete:
                </p>
                <Accordion type="multiple" className="mt-2">
                  {impacts.map((impact) => (
                    <AccordionItem
                      key={impact.label}
                      value={impact.label}
                      className="border-b-0"
                    >
                      <AccordionTrigger className="py-1.5 text-sm text-muted-foreground hover:no-underline">
                        <span>
                          {impact.count} {impact.label}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2 pt-0">
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                          {impact.items.map((item) => (
                            <li
                              key={item.id}
                              className="truncate pl-2"
                              title={item.displayName}
                            >
                              • {item.displayName}
                            </li>
                          ))}
                          {impact.hasMore && (
                            <li className="pl-2 italic">
                              +{impact.count - impact.items.length} more...
                            </li>
                          )}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </div>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={isExecuting}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading || isExecuting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isExecuting ? (
              <>
                <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
