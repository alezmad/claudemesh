"use client";

import { useMutation } from "@tanstack/react-query";
import { useState, useCallback } from "react";


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

interface PreviewResponse {
  userFacingImpacts: CascadeImpact[];
  totalAffected: number;
}

interface UseDestructiveActionOptions<TParams> {
  /** Function to call for preview (returns impact counts) */
  previewFn: (params: TParams) => Promise<PreviewResponse>;
  /** Function to call for actual deletion */
  executeFn: (params: TParams) => Promise<void>;
  /** Callback on successful deletion */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

interface UseDestructiveActionReturn<TParams> {
  /** Initiate the destructive action (shows preview dialog) */
  initiate: (params: TParams) => Promise<void>;
  /** Confirm and execute the action */
  confirm: () => Promise<void>;
  /** Cancel the action */
  cancel: () => void;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Whether preview is loading */
  isLoadingPreview: boolean;
  /** Whether deletion is executing */
  isExecuting: boolean;
  /** Cascade impacts to display */
  impacts: CascadeImpact[];
  /** The pending parameters (useful for displaying entity name) */
  pendingParams: TParams | null;
}

/**
 * Hook for managing destructive actions with cascade impact preview
 *
 * @example
 * const deleteAction = useDestructiveAction({
 *   previewFn: async ({ id }) => {
 *     const res = await api.connections[":id"].$delete({
 *       param: { id },
 *       query: { orgId, preview: "true" },
 *     });
 *     return res.json();
 *   },
 *   executeFn: async ({ id }) => {
 *     await api.connections[":id"].$delete({
 *       param: { id },
 *       query: { orgId },
 *     });
 *   },
 *   onSuccess: () => {
 *     queryClient.invalidateQueries({ queryKey: ["connections"] });
 *     toast.success("Deleted successfully");
 *   },
 * });
 *
 * // In JSX:
 * <Button onClick={() => deleteAction.initiate({ id: connection.id })}>Delete</Button>
 * <DestructiveActionDialog
 *   open={deleteAction.isOpen}
 *   impacts={deleteAction.impacts}
 *   isLoading={deleteAction.isLoadingPreview}
 *   isExecuting={deleteAction.isExecuting}
 *   onConfirm={deleteAction.confirm}
 *   onCancel={deleteAction.cancel}
 * />
 */
export function useDestructiveAction<TParams>({
  previewFn,
  executeFn,
  onSuccess,
  onError,
}: UseDestructiveActionOptions<TParams>): UseDestructiveActionReturn<TParams> {
  const [pendingParams, setPendingParams] = useState<TParams | null>(null);
  const [impacts, setImpacts] = useState<CascadeImpact[]>([]);

  const previewMutation = useMutation({
    mutationFn: previewFn,
    onSuccess: (data) => {
      setImpacts(data.userFacingImpacts);
    },
    onError: (error) => {
      // Still show dialog even if preview fails
      console.error("Preview failed:", error);
      setImpacts([]);
    },
  });

  const executeMutation = useMutation({
    mutationFn: executeFn,
    onSuccess: () => {
      setPendingParams(null);
      setImpacts([]);
      onSuccess?.();
    },
    onError: (error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });

  const initiate = useCallback(
    async (params: TParams) => {
      setPendingParams(params);
      setImpacts([]);
      await previewMutation.mutateAsync(params);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewMutation.mutateAsync],
  );

  const confirm = useCallback(async () => {
    if (pendingParams) {
      await executeMutation.mutateAsync(pendingParams);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingParams, executeMutation.mutateAsync]);

  const cancel = useCallback(() => {
    setPendingParams(null);
    setImpacts([]);
  }, []);

  return {
    initiate,
    confirm,
    cancel,
    isOpen: pendingParams !== null,
    isLoadingPreview: previewMutation.isPending,
    isExecuting: executeMutation.isPending,
    impacts,
    pendingParams,
  };
}
