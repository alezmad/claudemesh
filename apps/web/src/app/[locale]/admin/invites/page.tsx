import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
} from "nuqs/server";
import { Suspense } from "react";

import { getInvitesResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { pickBy } from "@turbostarter/shared/utils";
import { DataTableSkeleton } from "@turbostarter/ui-web/data-table/data-table-skeleton";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { InvitesDataTable } from "~/modules/admin/invites/data-table/invites-data-table";
import { getSortingStateParser } from "~/modules/common/hooks/use-data-table/common";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(20),
  sort: getSortingStateParser().withDefault([
    { id: "createdAt", desc: true },
  ]),
  q: parseAsString,
  revoked: parseAsBoolean,
  expired: parseAsBoolean,
});

export const generateMetadata = getMetadata({
  title: "Invites · Admin",
  description: "Mesh invite tokens across the system.",
});

export default async function InvitesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { page, perPage, sort, ...rest } =
    searchParamsCache.parse(searchParams);

  const filters = pickBy(rest, Boolean);

  const promise = handle(api.admin.invites.$get, {
    schema: getInvitesResponseSchema,
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
          <DashboardHeaderTitle>Invites</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            Mesh invite tokens — active, revoked, expired, exhausted.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <Suspense
        fallback={
          <DataTableSkeleton
            columnCount={6}
            filterCount={2}
            cellWidths={["12rem", "8rem", "5rem", "5rem", "7rem", "5rem"]}
            shrinkZero
          />
        }
      >
        <InvitesDataTable promise={promise} perPage={perPage} />
      </Suspense>
    </>
  );
}
