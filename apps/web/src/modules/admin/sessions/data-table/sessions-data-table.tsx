"use client";

import { use } from "react";

import { DataTable } from "@turbostarter/ui-web/data-table/data-table";
import { DataTableToolbar } from "@turbostarter/ui-web/data-table/data-table-toolbar";

import { useDataTable } from "~/modules/common/hooks/use-data-table";

import { useSessionColumns } from "./columns";

import type { GetSessionsResponse } from "@turbostarter/api/schema";

interface Props {
  readonly promise: Promise<Awaited<GetSessionsResponse>>;
  readonly perPage: number;
}

export const SessionsDataTable = ({ promise, perPage }: Props) => {
  const columns = useSessionColumns();
  const { data, total } = use(promise);

  const { table } = useDataTable({
    persistance: "searchParams",
    data,
    columns,
    pageCount: Math.ceil(total / perPage),
    initialState: {
      sorting: [{ id: "lastPingAt", desc: true }],
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
