import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";

export const metadata: Metadata = pageMetadata("ko", "recruit");

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor("ko", "recruit")) }}
      />
      <HomeKo initialTab="recruit" />
    </>
  );
}
