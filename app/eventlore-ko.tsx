"use client";

// 로케일 고정 진입점 — 데이터를 정적 import 해야 청크가 로케일별로 갈린다
// (home-ko/en/ja.tsx, autochess-*.tsx 와 같은 규약).
import EventLore, { type LoreDoc } from "./eventlore";
import doc from "./data/eventlore.json";

export default function EventLoreKo() {
  return <EventLore doc={doc as unknown as LoreDoc} />;
}
