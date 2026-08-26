import type { Metadata } from "next";
import HomeEn from "../../home-en";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";

export const metadata: Metadata = pageMetadata("en", "rogue");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("en", "rogue")} />
      <HomeEn initialTab="rogue" />
    </>
  );
}
