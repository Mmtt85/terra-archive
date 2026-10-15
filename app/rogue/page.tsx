import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RouteOnly from "../route-only";
import { RogueHubSeo } from "../page-seo/rogue";

export const metadata: Metadata = pageMetadata("ko", "rogue");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "rogue")} />
      <HomeKo initialTab="rogue" pageSeo={<RouteOnly path="/rogue"><RogueHubSeo /></RouteOnly>} />
    </>
  );
}
