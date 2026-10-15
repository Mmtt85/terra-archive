import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RouteOnly from "../route-only";
import { SimSeo } from "../page-seo/tools";

export const metadata: Metadata = pageMetadata("ko", "sim");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "sim")} />
      <HomeKo initialTab="sim" pageSeo={<RouteOnly path="/sim"><SimSeo /></RouteOnly>} />
    </>
  );
}
