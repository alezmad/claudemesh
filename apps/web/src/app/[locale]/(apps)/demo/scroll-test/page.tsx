/* eslint-disable i18next/no-literal-string */
"use client";

import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@turbostarter/ui-web/card";
import { Icons } from "@turbostarter/ui-web/icons";
import { ScrollAreaWithShadows } from "@turbostarter/ui-web/scroll-area";

export default function ScrollTestPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mb-8">
        <Link
          href="/demo"
          className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icons.ArrowLeft className="mr-1 h-4 w-4" />
          Back to demos
        </Link>
        <h1 className="text-2xl font-bold">Scroll Fade Demo</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          CSS mask-image based scroll indicators that fade content at edges
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {/* Card with scrollable content */}
        <Card>
          <CardHeader>
            <CardTitle>Scrollable Card</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollAreaWithShadows className="px-6 pb-6" maxHeight="300px">
              <div className="space-y-4">
                {Array.from({ length: 20 }, (_, i) => (
                  <div key={i} className="rounded-lg border p-4">
                    <h3 className="font-medium">Item {i + 1}</h3>
                    <p className="text-muted-foreground text-sm">
                      This is some sample content for item {i + 1}.
                      Scroll up and down to see the fade effect at the edges.
                    </p>
                  </div>
                ))}
              </div>
            </ScrollAreaWithShadows>
          </CardContent>
        </Card>

        {/* Another card for comparison */}
        <Card>
          <CardHeader>
            <CardTitle>Another Scrollable Card</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollAreaWithShadows className="px-6 pb-6" maxHeight="300px">
              <div className="space-y-3">
                {Array.from({ length: 15 }, (_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md bg-muted/50 p-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                      {i + 1}
                    </div>
                    <div>
                      <div className="font-medium">List item {i + 1}</div>
                      <div className="text-muted-foreground text-sm">
                        Description text here
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollAreaWithShadows>
          </CardContent>
        </Card>

        {/* Short content - no scroll needed */}
        <Card>
          <CardHeader>
            <CardTitle>No Scroll Needed</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollAreaWithShadows className="px-6 pb-6" maxHeight="300px">
              <div className="space-y-4">
                <div className="rounded-lg border p-4">
                  <h3 className="font-medium">Single Item</h3>
                  <p className="text-muted-foreground text-sm">
                    This card has little content, so no fade effect should appear.
                  </p>
                </div>
              </div>
            </ScrollAreaWithShadows>
          </CardContent>
        </Card>

        {/* Taller card */}
        <Card>
          <CardHeader>
            <CardTitle>Taller Scroll Area</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollAreaWithShadows className="px-6 pb-6" maxHeight="400px">
              <div className="space-y-4">
                {Array.from({ length: 25 }, (_, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-dashed p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Row {i + 1}</span>
                      <span className="text-muted-foreground text-xs">
                        {new Date().toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm">
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                      Sed do eiusmod tempor incididunt ut labore.
                    </p>
                  </div>
                ))}
              </div>
            </ScrollAreaWithShadows>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
