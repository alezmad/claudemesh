/* eslint-disable */
// @ts-nocheck — Payload generates these types at build time
import { RootPage, generatePageMetadata } from "@payloadcms/next/views";
import { importMap } from "../importMap";
import config from "@payload-config";

type Args = { params: Promise<{ segments: string[] }> };

export const generateMetadata = ({ params }: Args) =>
  generatePageMetadata({ config, params });

export default function Page({ params }: Args) {
  return <RootPage config={config} params={params} importMap={importMap} />;
}
