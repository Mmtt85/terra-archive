import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";

export const metadata: Metadata = pageMetadata("ko", "autochess");

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor("ko", "autochess")) }}
      />
      <HomeKo initialTab="autochess" />
    </>
  );
}
