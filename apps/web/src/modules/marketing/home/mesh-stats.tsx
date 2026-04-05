import {
  publicStatsResponseSchema,
  type PublicStatsResponse,
} from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";

import { api } from "~/lib/api/server";

const ZERO_STATS: PublicStatsResponse = {
  messagesRouted: 0,
  meshesCreated: 0,
  peersActive: 0,
  lastUpdated: new Date(0).toISOString(),
};

const fetchStats = async (): Promise<PublicStatsResponse> => {
  try {
    return await handle(api.public.stats.$get, {
      schema: publicStatsResponseSchema,
    })();
  } catch {
    return ZERO_STATS;
  }
};

const nf = new Intl.NumberFormat("en-US");

export const MeshStats = async () => {
  const stats = await fetchStats();
  const empty = stats.messagesRouted === 0;

  return (
    <section className="border-t border-[var(--cm-border)] bg-[var(--cm-bg)] px-6 py-10 md:px-12">
      <div className="mx-auto max-w-[var(--cm-max-w)]">
        <div
          className="flex flex-col items-center gap-1 text-center text-[13px] text-[var(--cm-fg-tertiary)] md:flex-row md:justify-center md:gap-2"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          <span className="text-[var(--cm-fg-secondary)]">
            ciphertext routed
          </span>
          <span className="text-[var(--cm-clay)]">→</span>
          {empty ? (
            <span className="text-[var(--cm-fg-secondary)]">
              ready to route
            </span>
          ) : (
            <>
              <span className="tabular-nums text-[var(--cm-fg)]">
                {nf.format(stats.messagesRouted)} messages
              </span>
              <span className="hidden text-[var(--cm-border)] md:inline">·</span>
              <span className="tabular-nums text-[var(--cm-fg-secondary)]">
                {nf.format(stats.meshesCreated)} meshes
              </span>
              <span className="hidden text-[var(--cm-border)] md:inline">·</span>
              <span className="tabular-nums text-[var(--cm-fg-secondary)]">
                {nf.format(stats.peersActive)} peers online
              </span>
            </>
          )}
        </div>
        <p
          className="mt-2 text-center text-[11px] text-[var(--cm-fg-tertiary)]/70"
          style={{ fontFamily: "var(--cm-font-mono)" }}
        >
          broker sees none of it
        </p>
      </div>
    </section>
  );
};
