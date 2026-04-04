/* eslint-disable i18next/no-literal-string */
"use client";

import Link from "next/link";

import { cn } from "@turbostarter/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@turbostarter/ui-web/card";
import { Icons } from "@turbostarter/ui-web/icons";

interface DemoItem {
  title: string;
  description: string;
  href: string;
  icon: keyof typeof Icons;
  status: "stable" | "experimental" | "new";
}

const demos: DemoItem[] = [
  {
    title: "Scroll Fade",
    description: "CSS mask-image based scroll indicators that fade content at edges when scrollable.",
    href: "/demo/scroll-test",
    icon: "ScrollText",
    status: "new",
  },
];

const statusStyles = {
  stable: "bg-green-500/10 text-green-500 border-green-500/20",
  experimental: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

const statusLabels = {
  stable: "Stable",
  experimental: "Experimental",
  new: "New",
};

export default function DemoHubPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icons.LayoutDashboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Component Demos</h1>
              <p className="text-muted-foreground text-sm">
                Interactive demonstrations of UI components and patterns
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        {demos.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Icons.Package className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">No demos available yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {demos.map((demo) => {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              const Icon = Icons[demo.icon] || Icons.Package;
              return (
                <Link key={demo.href} href={demo.href}>
                  <Card className="group h-full transition-all hover:border-primary/50 hover:shadow-md">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary/10">
                          <Icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" />
                        </div>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            statusStyles[demo.status]
                          )}
                        >
                          {statusLabels[demo.status]}
                        </span>
                      </div>
                      <CardTitle className="mt-3 text-lg">{demo.title}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {demo.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center text-sm text-muted-foreground group-hover:text-primary">
                        <span>View demo</span>
                        <Icons.ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}

        {/* Footer info */}
        <div className="mt-12 rounded-lg border border-dashed bg-muted/30 p-6">
          <div className="flex items-start gap-3">
            <Icons.Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Adding new demos</p>
              <p className="text-sm text-muted-foreground">
                Create a new folder in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">app/[locale]/(apps)/demo/</code> and
                add it to the demos array in this page.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
