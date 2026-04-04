"use client";

import { useState } from "react";

import { Button } from "@turbostarter/ui-web/button";

export const ExportData = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/my/export", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const data = (await res.json()) as { user: { id: string } };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `claudemesh-export-${data.user.id}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-5">
      <h3 className="mb-1 font-medium">Export your data</h3>
      <p className="text-muted-foreground mb-4 text-sm">
        Download a JSON file with your profile, meshes you own, meshes you
        joined, invites you&apos;ve issued, and audit events from your owned
        meshes. Read-only.
      </p>
      <Button onClick={onExport} disabled={loading} variant="outline" size="sm">
        {loading ? "Preparing…" : "Download export"}
      </Button>
      {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
    </div>
  );
};
