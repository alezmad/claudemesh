"use client";

import { use } from "react";

import { DataTable } from "@turbostarter/ui-web/data-table/data-table";
import { DataTableToolbar } from "@turbostarter/ui-web/data-table/data-table-toolbar";

import { useDataTable } from "~/modules/common/hooks/use-data-table";

import { useInviteColumns } from "./columns";

import type { GetInvitesResponse } from "@turbostarter/api/schema";

interface Props {
  readonly promise: Promise<Awaited<GetInvitesResponse>>;
  readonly perPage: number;
}

export const InvitesDataTable = ({ promise, perPage }: Props) => {
  const columns = useInviteColumns();
  const { data, total } = use(promise);

  const { table } = useDataTable({
    persistance: "searchParams",
    data,
    columns,
    pageCount: Math.ceil(total / perPage),
    initialState: {
      sorting: [{ id: "createdAt", desc: true }],
      columnVisibility: { q: false },
    },
    shallow: false,
    clearOnDefault: true,
    enableRowSelection: false,
  });

  return (
    <div className="flex w-full flex-col gap-2">
      <DataTableToolbar table={table} />
      <DataTable table={table} />
    </div>
  );
};
