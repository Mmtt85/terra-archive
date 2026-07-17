import type { Metadata } from "next";
import HomeJa from "../../home-ja";
import { pageMetadata, jsonLdFor } from "../../seo";

export const metadata: Metadata = pageMetadata("ja", "rogue");

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor("ja", "rogue")) }}
      />
      <HomeJa initialTab="rogue" />
    </>
  );
}
