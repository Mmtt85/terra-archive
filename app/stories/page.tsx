import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RouteOnly from "../route-only";
import StoriesSeo from "../page-seo/stories";

export const metadata: Metadata = pageMetadata("ko", "story");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "story")} />
      <HomeKo initialTab="story" pageSeo={<RouteOnly path="/stories"><StoriesSeo /></RouteOnly>} />
    </>
  );
}
