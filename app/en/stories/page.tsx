import type { Metadata } from "next";
import HomeEn from "../../home-en";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import StoriesSeo from "../../page-seo/stories";

export const metadata: Metadata = pageMetadata("en", "story");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("en", "story")} />
      <HomeEn initialTab="story" pageSeo={<RouteOnly path="/en/stories"><StoriesSeo lang="en" /></RouteOnly>} />
    </>
  );
}
