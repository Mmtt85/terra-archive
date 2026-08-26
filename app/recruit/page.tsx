import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";

export const metadata: Metadata = pageMetadata("ko", "recruit");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "recruit")} />
      <HomeKo initialTab="recruit" />
    </>
  );
}
