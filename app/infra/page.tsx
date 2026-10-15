import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RouteOnly from "../route-only";
import { InfraSeo } from "../page-seo/tools";

export const metadata: Metadata = pageMetadata("ko", "planner");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "planner")} />
      <HomeKo initialTab="planner" pageSeo={<RouteOnly path="/infra"><InfraSeo /></RouteOnly>} />
    </>
  );
}
