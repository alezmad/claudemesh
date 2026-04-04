import {
  createSearchParamsCache,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
} from "nuqs/server";
import { Suspense } from "react";

import { getAuditResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { pickBy } from "@turbostarter/shared/utils";
import { DataTableSkeleton } from "@turbostarter/ui-web/data-table/data-table-skeleton";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { AuditDataTable } from "~/modules/admin/audit/data-table/audit-data-table";
import { getSortingStateParser } from "~/modules/common/hooks/use-data-table/common";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(50),
  sort: getSortingStateParser().withDefault([
    { id: "createdAt", desc: true },
  ]),
  q: parseAsString,
  eventType: parseAsArrayOf(parseAsString),
  meshId: parseAsArrayOf(parseAsString),
  createdAt: parseAsArrayOf(parseAsInteger),
});

export const generateMetadata = getMetadata({
  title: "Audit · Admin",
  description: "Audit log of mesh events.",
});

export default async function AuditPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { page, perPage, sort, ...rest } =
    searchParamsCache.parse(searchParams);

  const filters = pickBy(rest, Boolean);

  const promise = handle(api.admin.audit.$get, {
    schema: getAuditResponseSchema,
  })({
    query: {
      ...filters,
      page: page.toString(),
      perPage: perPage.toString(),
      sort: JSON.stringify(sort),
    },
  });

  return (
    <>
      <DashboardHeader>
        <div>
          <DashboardHeaderTitle>Audit log</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            Metadata-only event log — no message content, only routing.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <Suspense
        fallback={
          <DataTableSkeleton
            columnCount={5}
            filterCount={2}
            cellWidths={["8rem", "10rem", "8rem", "8rem", "10rem"]}
            shrinkZero
          />
        }
      >
        <AuditDataTable promise={promise} perPage={perPage} />
      </Suspense>
    </>
  );
}
