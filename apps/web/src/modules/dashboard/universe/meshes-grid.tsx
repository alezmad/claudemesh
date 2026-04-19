import Link from "next/link";

import { pathsConfig } from "~/config/paths";

import { Reveal } from "./reveal";

interface MeshSummary {
  id: string;
  name: string;
  slug: string;
  tier: "free" | "pro" | "team" | "enterprise";
  myRole: "admin" | "member";
  isOwner: boolean;
  memberCount: number;
  archivedAt: Date | string | null;
}

const MAX_CHIPS = 6;

/**
 * Compact member-count chips. Real per-session live status would require
 * polling /stream for each mesh — we show the structure here and defer the
 * live overlay to the per-mesh live page.
 */
const MemberChips = ({ count }: { count: number }) => {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cm-border-soft,rgba(217,119,87,0.1))] bg-[var(--cm-bg)] px-2 py-1 text-[11px] text-[var(--cm-fg-tertiary)]">
        <span className="size-[6px] rounded-full bg-[var(--cm-fg-tertiary)]" />
        empty
      </span>
    );
  }
  const shown = Math.min(count, MAX_CHIPS);
  const extra = count - shown;
  return (
    <>
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--cm-border-soft,rgba(217,119,87,0.1))] bg-[var(--cm-bg)] px-2 py-1 text-[11px] text-[var(--cm-fg-secondary)]"
        >
          <span className="size-[6px] rounded-full bg-[var(--cm-cactus)]" />
          member
        </span>
      ))}
      {extra > 0 ? (
        <span className="px-1 font-mono text-[11px] text-[var(--cm-fg-tertiary)]">
          +{extra}
        </span>
      ) : null}
    </>
  );
};

const roleClass = (isOwner: boolean, role: string) => {
  if (isOwner) return "text-[var(--cm-clay)] border-[rgba(217,119,87,0.4)]";
  if (role === "admin") return "text-[var(--cm-cactus)] border-[rgba(188,209,202,0.4)]";
  return "text-[var(--cm-fg-secondary)]";
};

const MeshCard = ({
  mesh,
  size = "compact",
}: {
  mesh: MeshSummary;
  size?: "hero" | "compact";
}) => {
  const isHero = size === "hero";
  const href = pathsConfig.dashboard.user.meshes.mesh(mesh.id);

  return (
    <Link
      href={href}
      className={[
        "group relative flex flex-col rounded-md border border-[var(--cm-border)] bg-[var(--cm-bg-elevated)] transition-colors duration-300 hover:border-[var(--cm-border-hover)] hover:bg-[var(--cm-bg-hover)]",
        isHero ? "px-8 py-7" : "px-5 py-5",
        mesh.archivedAt ? "opacity-60" : "",
      ].join(" ")}
    >
      {isHero ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-[30%] -top-[30%] h-[120%] w-[70%] opacity-60"
          style={{
            background:
              "radial-gradient(ellipse, rgba(217,119,87,0.10), transparent 60%)",
          }}
        />
      ) : null}

      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3
            className={[
              "truncate tracking-tight",
              isHero ? "text-[34px]" : "text-[20px]",
            ].join(" ")}
            style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
          >
            {isHero ? (
              <em className="italic text-[var(--cm-clay)]">{mesh.name}</em>
            ) : (
              mesh.name
            )}
          </h3>
          <p
            className="truncate text-[12px] text-[var(--cm-fg-tertiary)]"
            style={{ fontFamily: "var(--cm-font-mono)" }}
          >
            {mesh.slug}
            {isHero ? ` · id ${mesh.id.slice(0, 8)}…` : ""}
          </p>
        </div>
        <span
          className={[
            "whitespace-nowrap rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
            roleClass(mesh.isOwner, mesh.myRole),
            "border-[var(--cm-border)]",
          ].join(" ")}
        >
          {mesh.archivedAt ? "archived" : mesh.isOwner ? "owner" : mesh.myRole}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <MemberChips count={mesh.memberCount} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--cm-border-soft,rgba(217,119,87,0.1))] pt-3 font-mono text-[11px] tracking-[0.04em] text-[var(--cm-fg-tertiary)]">
        <span className={mesh.memberCount > 0 ? "text-[var(--cm-cactus)]" : ""}>
          {mesh.memberCount} {mesh.memberCount === 1 ? "MEMBER" : "MEMBERS"}
          {" · "}
          <span className="uppercase">{mesh.tier}</span>
        </span>
        <span className="text-[var(--cm-fg-tertiary)] transition-transform duration-300 group-hover:translate-x-0.5">
          open →
        </span>
      </div>
    </Link>
  );
};

export const MeshesGrid = ({ meshes }: { meshes: MeshSummary[] }) => {
  if (meshes.length === 0) {
    return (
      <section className="mb-14">
        <div className="rounded-md border border-dashed border-[var(--cm-border)] px-10 py-14 text-center">
          <p className="mb-5 text-[var(--cm-fg-secondary)]">
            You haven&rsquo;t joined any meshes yet.
          </p>
          <Link
            href={pathsConfig.dashboard.user.meshes.new}
            className="rounded-sm bg-[var(--cm-clay)] px-4 py-2 text-[13px] font-medium text-[var(--cm-gray-050)] transition-colors hover:bg-[var(--cm-clay-hover)]"
          >
            Create your first mesh
          </Link>
        </div>
      </section>
    );
  }

  const [hero, ...rest] = meshes;
  const heroMesh = hero!;

  return (
    <section className="mb-14">
      <Reveal delay={0}>
        <div className="mb-6 flex items-baseline justify-between gap-6">
          <h2
            className="text-[28px] leading-none tracking-tight"
            style={{ fontFamily: "var(--cm-font-serif)", fontWeight: 400 }}
          >
            Your <span className="italic text-[var(--cm-clay)]">meshes</span>
          </h2>
          <Link
            href={pathsConfig.dashboard.user.meshes.new}
            className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--cm-clay)] px-3 py-1.5 text-[13px] font-medium text-[var(--cm-gray-050)] transition-colors hover:bg-[var(--cm-clay-hover)]"
          >
            <span>+</span> New mesh
          </Link>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Reveal delay={1} className="row-span-2">
          <MeshCard mesh={heroMesh} size="hero" />
        </Reveal>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {rest.slice(0, 2).map((m, i) => (
            <Reveal key={m.id} delay={i + 2}>
              <MeshCard mesh={m} />
            </Reveal>
          ))}
        </div>

        {rest.length > 2 ? (
          <div className="col-span-full grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {rest.slice(2).map((m, i) => (
              <Reveal key={m.id} delay={i + 4}>
                <MeshCard mesh={m} />
              </Reveal>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};
