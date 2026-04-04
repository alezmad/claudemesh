import { Badge } from "@turbostarter/ui-web/badge";
import { DataTableColumnHeader } from "@turbostarter/ui-web/data-table/data-table-column-header";

import { TurboLink } from "~/modules/common/turbo-link";

import type { ColumnDef } from "@tanstack/react-table";
import type { GetInvitesResponse } from "@turbostarter/api/schema";

type Invite = GetInvitesResponse["data"][number];

export const useInviteColumns = (): ColumnDef<Invite>[] => [
  {
    id: "q",
    accessorKey: "q",
    meta: { placeholder: "Search by mesh or token…", variant: "text" },
    enableHiding: false,
    enableColumnFilter: true,
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
    enableHiding: false,
  },
  {
    id: "token",
    accessorKey: "token",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Token" />
    ),
    cell: ({ row }) => (
      <code className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
        {row.original.token.slice(0, 12)}…
      </code>
    ),
    meta: { label: "Token" },
  },
  {
    id: "role",
    accessorKey: "role",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Role" />
    ),
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.role}</Badge>
    ),
    meta: { label: "Role" },
  },
  {
    id: "uses",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Uses" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        {row.original.usedCount} / {row.original.maxUses}
      </span>
    ),
    meta: { label: "Uses" },
  },
  {
    id: "expiresAt",
    accessorKey: "expiresAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Expires" />
    ),
    cell: ({ row }) => {
      const expired = new Date(row.original.expiresAt) < new Date();
      return (
        <span
          className={
            "text-sm " + (expired ? "text-destructive" : "text-muted-foreground")
          }
        >
          {new Date(row.original.expiresAt).toLocaleDateString()}
          {expired && " (expired)"}
        </span>
      );
    },
    meta: { label: "Expires" },
  },
  {
    id: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      if (row.original.revokedAt) {
        return (
          <Badge className="bg-destructive/15 text-destructive">revoked</Badge>
        );
      }
      if (new Date(row.original.expiresAt) < new Date()) {
        return <Badge variant="outline">expired</Badge>;
      }
      if (row.original.usedCount >= row.original.maxUses) {
        return <Badge variant="outline">exhausted</Badge>;
      }
      return (
        <Badge className="bg-success/15 text-success">active</Badge>
      );
    },
    meta: { label: "Status" },
  },
];
