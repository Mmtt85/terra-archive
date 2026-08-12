"use client";

import SandboxGuide, { type SandboxDoc } from "./sandbox";
import doc from "./data/sandbox.ja.json";

export default function SandboxJa({ includeFuture }: { includeFuture?: boolean }) {
  return <SandboxGuide doc={doc as unknown as SandboxDoc} includeFuture={includeFuture} />;
}
