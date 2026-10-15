import type { Metadata } from "next";
import HomeJa from "../../home-ja";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import { GachaSeo } from "../../page-seo/tools";

export const metadata: Metadata = pageMetadata("ja", "gacha");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ja", "gacha")} />
      <HomeJa initialTab="gacha" pageSeo={<RouteOnly path="/ja/gacha"><GachaSeo lang="ja" /></RouteOnly>} />
    </>
  );
}
