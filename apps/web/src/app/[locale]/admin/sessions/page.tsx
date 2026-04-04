import {
  createSearchParamsCache,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from "nuqs/server";
import { Suspense } from "react";

import { getSessionsResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { pickBy } from "@turbostarter/shared/utils";
import { DataTableSkeleton } from "@turbostarter/ui-web/data-table/data-table-skeleton";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { SessionsDataTable } from "~/modules/admin/sessions/data-table/sessions-data-table";
import { getSortingStateParser } from "~/modules/common/hooks/use-data-table/common";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";

const STATUS_VALUES = ["idle", "working", "dnd"] as const;

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(20),
  sort: getSortingStateParser().withDefault([
    { id: "lastPingAt", desc: true },
  ]),
  q: parseAsString,
  status: parseAsArrayOf(parseAsStringEnum([...STATUS_VALUES])),
  active: parseAsBoolean,
});

export const generateMetadata = getMetadata({
  title: "Sessions · Admin",
  description: "Live Claude Code sessions across all meshes.",
});

export default async function SessionsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { page, perPage, sort, ...rest } =
    searchParamsCache.parse(searchParams);

  const filters = pickBy(rest, Boolean);

  const promise = handle(api.admin.sessions.$get, {
    schema: getSessionsResponseSchema,
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
          <DashboardHeaderTitle>Sessions</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            Live Claude Code presences across every mesh.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <Suspense
        fallback={
          <DataTableSkeleton
            columnCount={5}
            filterCount={2}
            cellWidths={["6rem", "10rem", "12rem", "14rem", "6rem"]}
            shrinkZero
          />
        }
      >
        <SessionsDataTable promise={promise} perPage={perPage} />
      </Suspense>
    </>
  );
}
