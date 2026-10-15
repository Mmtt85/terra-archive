import type { Metadata } from "next";
import HomeJa from "../../home-ja";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";
import RouteOnly from "../../route-only";
import RecruitSeo from "../../page-seo/recruit";

export const metadata: Metadata = pageMetadata("ja", "recruit");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ja", "recruit")} />
      <HomeJa initialTab="recruit" pageSeo={<RouteOnly path="/ja/recruit"><RecruitSeo lang="ja" /></RouteOnly>} />
    </>
  );
}
