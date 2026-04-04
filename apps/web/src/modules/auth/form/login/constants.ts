import { AuthProvider } from "@turbostarter/auth";

export const LOGIN_OPTIONS = [AuthProvider.PASSWORD, AuthProvider.MAGIC_LINK];

export type LoginOption = (typeof LOGIN_OPTIONS)[number];
