import type { Metadata } from "next";
import HomeEn from "../home-en";
import { pageMetadata, jsonLdFor } from "../seo";

export const metadata: Metadata = pageMetadata("en");

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor("en")) }}
      />
      <HomeEn />
    </>
  );
}
