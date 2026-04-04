import { Badge } from "@turbostarter/ui-web/badge";
import { DataTableColumnHeader } from "@turbostarter/ui-web/data-table/data-table-column-header";

import { TurboLink } from "~/modules/common/turbo-link";

import type { ColumnDef } from "@tanstack/react-table";
import type { GetMeshesResponse } from "@turbostarter/api/schema";

type Mesh = GetMeshesResponse["data"][number];

const TIER_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  pro: "bg-blue-500/15 text-blue-600",
  team: "bg-purple-500/15 text-purple-600",
  enterprise: "bg-amber-500/15 text-amber-600",
};

const TRANSPORT_COLORS: Record<string, string> = {
  managed: "bg-primary/15 text-primary",
  tailscale: "bg-emerald-500/15 text-emerald-600",
  self_hosted: "bg-zinc-500/15 text-zinc-600",
};

export const useMeshColumns = (): ColumnDef<Mesh>[] => [
  {
    id: "q",
    accessorKey: "q",
    meta: { placeholder: "Search by name or slug…", variant: "text" },
    enableHiding: false,
    enableColumnFilter: true,
  },
  {
    id: "name",
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Mesh" />
    ),
    cell: ({ row }) => (
      <TurboLink
        href={`/admin/meshes/${row.original.id}`}
        className="group flex flex-col gap-0.5"
      >
        <span className="group-hover:text-primary truncate font-medium underline underline-offset-4">
          {row.original.name}
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          {row.original.slug}
        </span>
      </TurboLink>
    ),
    enableHiding: false,
  },
  {
    id: "owner",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Owner" />
    ),
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {row.original.ownerName ?? "—"}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {row.original.ownerEmail ?? "—"}
        </span>
      </div>
    ),
    meta: { label: "Owner" },
  },
  {
    id: "tier",
    accessorKey: "tier",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Tier" />
    ),
    cell: ({ row }) => (
      <Badge
        variant="secondary"
        className={TIER_COLORS[row.original.tier] ?? ""}
      >
        {row.original.tier}
      </Badge>
    ),
    meta: {
      label: "Tier",
      variant: "multiSelect",
      options: [
        { label: "Free", value: "free" },
        { label: "Pro", value: "pro" },
        { label: "Team", value: "team" },
        { label: "Enterprise", value: "enterprise" },
      ],
    },
    enableColumnFilter: true,
  },
  {
    id: "transport",
    accessorKey: "transport",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Transport" />
    ),
    cell: ({ row }) => (
      <Badge
        variant="secondary"
        className={TRANSPORT_COLORS[row.original.transport] ?? ""}
      >
        {row.original.transport}
      </Badge>
    ),
    meta: {
      label: "Transport",
      variant: "multiSelect",
      options: [
        { label: "Managed", value: "managed" },
        { label: "Tailscale", value: "tailscale" },
        { label: "Self-hosted", value: "self_hosted" },
      ],
    },
    enableColumnFilter: true,
  },
  {
    id: "memberCount",
    accessorKey: "memberCount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Members" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.memberCount}</span>
    ),
    meta: { label: "Members" },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {new Date(row.original.createdAt).toLocaleDateString()}
      </span>
    ),
    meta: { label: "Created" },
  },
];
