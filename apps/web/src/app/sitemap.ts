import { getPathname, config } from "@turbostarter/i18n";

import { appConfig } from "~/config/app";
import { pathsConfig } from "~/config/paths";

import type { MetadataRoute } from "next";

const url = (path: string) => `${appConfig.url}${path}`;

const getEntry = (path: string) => ({
  url: url(
    getPathname({
      path,
      locale: appConfig.locale,
      defaultLocale: appConfig.locale,
    }),
  ),
  alternates: {
    languages: Object.fromEntries(
      config.locales.map((locale) => [
        locale,
        url(
          getPathname({
            path,
            locale,
            defaultLocale: appConfig.locale,
          }),
        ),
      ]),
    ),
  },
});

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      ...getEntry(pathsConfig.index),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      ...getEntry(pathsConfig.marketing.pricing),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      ...getEntry(pathsConfig.marketing.contact),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
