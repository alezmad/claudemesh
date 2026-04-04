"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "~/lib/api/client";

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingDetail {
  id: string;
  content: string;
  pageNumber: number;
  charStart?: number;
  charEnd?: number;
  sectionTitle?: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch embedding details by ID for citation highlighting
 */
export function useEmbedding(embeddingId: string | null) {
  return useQuery({
    queryKey: ["pdf", "embedding", embeddingId],
    queryFn: async (): Promise<EmbeddingDetail | null> => {
      if (!embeddingId) return null;

      const response = await api.ai.pdf.embeddings[":id"].$get({
        param: { id: embeddingId },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("Failed to fetch embedding");
      }

      return response.json() as Promise<EmbeddingDetail>;
    },
    enabled: Boolean(embeddingId),
    staleTime: Infinity, // Embeddings don't change
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
  });
}
