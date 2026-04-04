import { Badge } from "@turbostarter/ui-web/badge";
import { DataTableColumnHeader } from "@turbostarter/ui-web/data-table/data-table-column-header";

import { TurboLink } from "~/modules/common/turbo-link";

import type { ColumnDef } from "@tanstack/react-table";
import type { GetAuditResponse } from "@turbostarter/api/schema";

type Audit = GetAuditResponse["data"][number];

export const useAuditColumns = (): ColumnDef<Audit>[] => [
  {
    id: "q",
    accessorKey: "q",
    meta: {
      placeholder: "Search by event, peer, mesh…",
      variant: "text",
    },
    enableHiding: false,
    enableColumnFilter: true,
  },
  {
    id: "eventType",
    accessorKey: "eventType",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Event" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline" className="font-mono text-xs">
        {row.original.eventType}
      </Badge>
    ),
    meta: { label: "Event" },
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
          <span className="group-hover:text-primary text-sm underline underline-offset-4">
            {row.original.meshName ?? "—"}
          </span>
        </TurboLink>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: { label: "Mesh" },
  },
  {
    id: "actor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Actor" />
    ),
    cell: ({ row }) =>
      row.original.actorPeerId ? (
        <code className="text-muted-foreground font-mono text-xs">
          {row.original.actorPeerId.slice(0, 12)}…
        </code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: { label: "Actor" },
  },
  {
    id: "target",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Target" />
    ),
    cell: ({ row }) =>
      row.original.targetPeerId ? (
        <code className="text-muted-foreground font-mono text-xs">
          {row.original.targetPeerId.slice(0, 12)}…
        </code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: { label: "Target" },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="When" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.original.createdAt).toLocaleString()}
      </span>
    ),
    meta: { label: "When" },
  },
];
