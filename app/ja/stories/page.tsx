import type { Metadata } from "next";
import HomeJa from "../../home-ja";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";

export const metadata: Metadata = pageMetadata("ja", "story");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ja", "story")} />
      <HomeJa initialTab="story" />
    </>
  );
}
