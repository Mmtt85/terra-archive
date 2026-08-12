"use client";

import SandboxGuide, { type SandboxDoc } from "./sandbox";
import doc from "./data/sandbox.en.json";

export default function SandboxEn({ includeFuture }: { includeFuture?: boolean }) {
  return <SandboxGuide doc={doc as unknown as SandboxDoc} includeFuture={includeFuture} />;
}
