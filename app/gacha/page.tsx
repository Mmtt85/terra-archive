import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RouteOnly from "../route-only";
import { GachaSeo } from "../page-seo/tools";

export const metadata: Metadata = pageMetadata("ko", "gacha");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "gacha")} />
      <HomeKo initialTab="gacha" pageSeo={<RouteOnly path="/gacha"><GachaSeo /></RouteOnly>} />
    </>
  );
}
