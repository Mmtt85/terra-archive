import type { Metadata } from "next";
import HomeJa from "../../home-ja";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import { InfraSeo } from "../../page-seo/tools";

export const metadata: Metadata = pageMetadata("ja", "planner");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ja", "planner")} />
      <HomeJa initialTab="planner" pageSeo={<RouteOnly path="/ja/infra"><InfraSeo lang="ja" /></RouteOnly>} />
    </>
  );
}
