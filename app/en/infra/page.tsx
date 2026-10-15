import type { Metadata } from "next";
import HomeEn from "../../home-en";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import { InfraSeo } from "../../page-seo/tools";

export const metadata: Metadata = pageMetadata("en", "planner");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("en", "planner")} />
      <HomeEn initialTab="planner" pageSeo={<RouteOnly path="/en/infra"><InfraSeo lang="en" /></RouteOnly>} />
    </>
  );
}
