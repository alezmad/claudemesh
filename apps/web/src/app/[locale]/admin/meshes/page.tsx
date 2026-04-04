import {
  createSearchParamsCache,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
} from "nuqs/server";
import { Suspense } from "react";

import { getMeshesResponseSchema } from "@turbostarter/api/schema";
import { handle } from "@turbostarter/api/utils";
import { pickBy } from "@turbostarter/shared/utils";
import { DataTableSkeleton } from "@turbostarter/ui-web/data-table/data-table-skeleton";

import { api } from "~/lib/api/server";
import { getMetadata } from "~/lib/metadata";
import { MeshesDataTable } from "~/modules/admin/meshes/data-table/meshes-data-table";
import { getSortingStateParser } from "~/modules/common/hooks/use-data-table/common";
import {
  DashboardHeader,
  DashboardHeaderDescription,
  DashboardHeaderTitle,
} from "~/modules/common/layout/dashboard/header";

const TIER_VALUES = ["free", "pro", "team", "enterprise"] as const;
const TRANSPORT_VALUES = ["managed", "tailscale", "self_hosted"] as const;
const VISIBILITY_VALUES = ["private", "public"] as const;

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(20),
  sort: getSortingStateParser().withDefault([
    { id: "createdAt", desc: true },
  ]),
  q: parseAsString,
  tier: parseAsArrayOf(parseAsStringEnum([...TIER_VALUES])),
  transport: parseAsArrayOf(parseAsStringEnum([...TRANSPORT_VALUES])),
  visibility: parseAsArrayOf(parseAsStringEnum([...VISIBILITY_VALUES])),
  archived: parseAsBoolean,
  createdAt: parseAsArrayOf(parseAsInteger),
});

export const generateMetadata = getMetadata({
  title: "Meshes · Admin",
  description: "All meshes in the system.",
});

export default async function MeshesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const { page, perPage, sort, ...rest } =
    searchParamsCache.parse(searchParams);

  const filters = pickBy(rest, Boolean);

  const promise = handle(api.admin.meshes.$get, {
    schema: getMeshesResponseSchema,
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
          <DashboardHeaderTitle>Meshes</DashboardHeaderTitle>
          <DashboardHeaderDescription>
            All meshes across the system — tier, transport, owner, member count.
          </DashboardHeaderDescription>
        </div>
      </DashboardHeader>
      <Suspense
        fallback={
          <DataTableSkeleton
            columnCount={6}
            filterCount={3}
            cellWidths={["14rem", "12rem", "6rem", "6rem", "5rem", "6rem"]}
            shrinkZero
          />
        }
      >
        <MeshesDataTable promise={promise} perPage={perPage} />
      </Suspense>
    </>
  );
}
