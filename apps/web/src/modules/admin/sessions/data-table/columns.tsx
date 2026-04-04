import { Badge } from "@turbostarter/ui-web/badge";
import { DataTableColumnHeader } from "@turbostarter/ui-web/data-table/data-table-column-header";

import { TurboLink } from "~/modules/common/turbo-link";

import type { ColumnDef } from "@tanstack/react-table";
import type { GetSessionsResponse } from "@turbostarter/api/schema";

type Session = GetSessionsResponse["data"][number];

const STATUS_COLORS: Record<string, string> = {
  working: "bg-primary/15 text-primary",
  idle: "bg-muted text-muted-foreground",
  dnd: "bg-destructive/15 text-destructive",
};

export const useSessionColumns = (): ColumnDef<Session>[] => [
  {
    id: "q",
    accessorKey: "q",
    meta: { placeholder: "Search by peer, cwd, mesh…", variant: "text" },
    enableHiding: false,
    enableColumnFilter: true,
  },
  {
    id: "status",
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const disconnected = row.original.disconnectedAt !== null;
      return (
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (disconnected
                ? "bg-muted-foreground/40"
                : row.original.status === "working"
                  ? "bg-primary animate-pulse"
                  : row.original.status === "dnd"
                    ? "bg-destructive"
                    : "bg-muted-foreground")
            }
          />
          <Badge
            variant="secondary"
            className={
              disconnected
                ? "bg-muted/50 text-muted-foreground"
                : (STATUS_COLORS[row.original.status] ?? "")
            }
          >
            {disconnected ? "disconnected" : row.original.status}
          </Badge>
        </div>
      );
    },
    meta: {
      label: "Status",
      variant: "multiSelect",
      options: [
        { label: "Working", value: "working" },
        { label: "Idle", value: "idle" },
        { label: "DND", value: "dnd" },
      ],
    },
    enableColumnFilter: true,
  },
  {
    id: "peer",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Peer" />
    ),
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          {row.original.displayName ?? "—"}
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          pid {row.original.pid}
        </span>
      </div>
    ),
    meta: { label: "Peer" },
  },
  {
    id: "mesh",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Mesh" />
    ),
    cell: ({ row }) =>
      row.original.meshId ? (
        <TurboLink
          href={`/admin/meshes/${row.original.meshId}`}
          className="group flex flex-col gap-0.5"
        >
          <span className="group-hover:text-primary text-sm font-medium underline underline-offset-4">
            {row.original.meshName ?? "—"}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {row.original.meshSlug ?? "—"}
          </span>
        </TurboLink>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: { label: "Mesh" },
  },
  {
    id: "cwd",
    accessorKey: "cwd",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="CWD" />
    ),
    cell: ({ row }) => (
      <code className="text-muted-foreground max-w-xs truncate text-xs">
        {row.original.cwd}
      </code>
    ),
    meta: { label: "CWD" },
  },
  {
    id: "lastPingAt",
    accessorKey: "lastPingAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last ping" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.original.lastPingAt).toLocaleTimeString()}
      </span>
    ),
    meta: { label: "Last ping" },
  },
];
