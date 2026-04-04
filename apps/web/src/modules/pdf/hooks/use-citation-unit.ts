"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "~/lib/api/client";

// ============================================================================
// Types
// ============================================================================

/**
 * Bounding box for pixel-perfect highlighting
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Citation unit with precise location for highlighting (WF-0028)
 */
export interface CitationUnitDetail {
  id: string;
  content: string;
  pageNumber: number;
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
  bbox: BoundingBox | null;
  sectionTitle: string | null;
  unitType: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch citation unit details by ID for bounding box-based highlighting
 *
 * Falls back to legacy embedding endpoint if citation unit not found
 */
export function useCitationUnit(unitId: string | null) {
  return useQuery({
    queryKey: ["pdf", "citation-unit", unitId],
    queryFn: async (): Promise<CitationUnitDetail | null> => {
      if (!unitId) return null;

      // Try citation unit endpoint first (WF-0028 dual-resolution)
      const response = await api.ai.pdf.search["citation-units"].single[":id"].$get({
        param: { id: unitId },
      });

      if (response.ok) {
        const result = await response.json();
        return (result as { data: CitationUnitDetail }).data;
      }

      // If not found in citation units, this might be a legacy embedding ID
      // Return null - the highlight layer will fall back to word overlap
      if (response.status === 404) {
        return null;
      }

      throw new Error("Failed to fetch citation unit");
    },
    enabled: Boolean(unitId),
    staleTime: Infinity, // Citation units don't change
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
  });
}
