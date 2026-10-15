import type { Metadata } from "next";
import HomeEn from "../../home-en";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import { SimSeo } from "../../page-seo/tools";

export const metadata: Metadata = pageMetadata("en", "sim");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("en", "sim")} />
      <HomeEn initialTab="sim" pageSeo={<RouteOnly path="/en/sim"><SimSeo lang="en" /></RouteOnly>} />
    </>
  );
}
