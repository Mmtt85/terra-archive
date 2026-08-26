import type { Metadata } from "next";
import HomeJa from "../../home-ja";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";

export const metadata: Metadata = pageMetadata("ja", "autochess");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ja", "autochess")} />
      <HomeJa initialTab="autochess" />
    </>
  );
}
