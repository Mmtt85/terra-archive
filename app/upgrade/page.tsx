import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RouteOnly from "../route-only";
import { UpgradeSeo } from "../page-seo/tools";

export const metadata: Metadata = pageMetadata("ko", "upgrade");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "upgrade")} />
      <HomeKo initialTab="upgrade" pageSeo={<RouteOnly path="/upgrade"><UpgradeSeo /></RouteOnly>} />
    </>
  );
}
