import { useEffect, useState } from "react";

import { useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@turbostarter/ui-web/accordion";
import { buttonVariants } from "@turbostarter/ui-web/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@turbostarter/ui-web/navigation-menu";

import { pathsConfig } from "~/config/paths";
import { TurboLink } from "~/modules/common/turbo-link";
import { CtaButton } from "~/modules/marketing/layout/cta-button";

import { Hamburger } from "./hamburger";
import { Item } from "./navigation";

import type { NavigationProps } from "./types";

export const MobileNavigation = ({ links }: NavigationProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [open]);

  return (
    <>
      <Hamburger open={open} onOpenChange={setOpen} className="lg:hidden" />

      <div className="pointer-events-none fixed top-14 left-0 z-10 flex h-[calc(100vh-3.5rem)] w-full flex-col gap-7 overflow-auto lg:hidden">
        <div
          className={cn(
            "absolute inset-0 bg-black/80 opacity-0 transition-opacity duration-500 ease-out",
            {
              "pointer-events-auto opacity-100": open,
            },
          )}
          onClick={() => setOpen(false)}
        ></div>
        <div
          className={cn(
            "bg-background flex w-full -translate-y-full flex-col gap-2 rounded-b-md px-[1.7rem] pb-6 transition-transform duration-500 ease-out sm:px-8",
            {
              "pointer-events-auto translate-y-0": open,
            },
          )}
        >
          <NavigationMenu className="w-full max-w-full py-2 [&>div]:w-full">
            <NavigationMenuList className="-mx-4 flex-col space-y-1">
              {links.map((link) => (
                <NavigationMenuItem key={link.label} className="w-full">
                  {"items" in link ? (
                    <Accordion type="single" collapsible>
                      <AccordionItem value="item-1">
                        <AccordionTrigger
                          className={cn(
                            navigationMenuTriggerStyle(),
                            "justify-between text-base font-medium hover:no-underline",
                          )}
                        >
                          {t(link.label)}
                        </AccordionTrigger>
                        <AccordionContent className="py-2">
                          <ul className="flex flex-col">
                            {link.items.map((item) => (
                              <Item
                                key={item.title}
                                {...item}
                                onClick={() => setOpen(false)}
                              />
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : (
                    <TurboLink
                      href={link.href}
                      className={cn(
                        navigationMenuTriggerStyle(),
                        "w-full justify-start text-base font-medium",
                      )}
                      onClick={() => setOpen(false)}
                    >
                      {t(link.label)}
                    </TurboLink>
                  )}
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          <div className="flex w-full flex-col gap-2">
            <TurboLink
              href={pathsConfig.marketing.contact}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("marketing:contact.cta")}
            </TurboLink>
            <CtaButton />
          </div>
        </div>
      </div>
    </>
  );
};
