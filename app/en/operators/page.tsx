import type { Metadata } from "next";
import HomeEn from "../../home-en";
import { pageMetadata, jsonLdFor } from "../../seo";
import JsonLd from "../../json-ld";

export const metadata: Metadata = pageMetadata("en", "archive");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("en", "archive")} />
      <HomeEn initialTab="archive" />
    </>
  );
}
