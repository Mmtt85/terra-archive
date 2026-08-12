"use client";

import SandboxGuide, { type SandboxDoc } from "./sandbox";
import doc from "./data/sandbox.en.json";

export default function SandboxEn({ includeFuture, season }: { includeFuture?: boolean; season?: "v2" | "v3" }) {
  return <SandboxGuide doc={doc as unknown as SandboxDoc} includeFuture={includeFuture} season={season} />;
}
