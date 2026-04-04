"use server";

import { cookies } from "next/headers";

import { config } from "@turbostarter/i18n";

import type { Locale } from "@turbostarter/i18n";

export const setLocaleCookie = async (locale: Locale) => {
  const cookieStore = await cookies();
  cookieStore.set(config.cookie, locale);
};
