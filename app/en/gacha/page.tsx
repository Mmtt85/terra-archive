import type { Metadata } from "next";
import HomeEn from "../../home-en";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import { GachaSeo } from "../../page-seo/tools";

export const metadata: Metadata = pageMetadata("en", "gacha");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("en", "gacha")} />
      <HomeEn initialTab="gacha" pageSeo={<RouteOnly path="/en/gacha"><GachaSeo lang="en" /></RouteOnly>} />
    </>
  );
}
