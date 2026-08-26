import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";

export const metadata: Metadata = pageMetadata("ko", "sim");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "sim")} />
      <HomeKo initialTab="sim" />
    </>
  );
}
