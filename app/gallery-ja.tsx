"use client";

// 로케일별 갤러리 래퍼 — 자기 언어 색인만 정적 임포트한다 (app/items-ko.tsx 와 같은 관례).
import Gallery, { type GalleryDoc, type GalleryOp } from "./gallery";
import doc from "./data/gallery.ja.json";

export default function GalleryJA(props: { operators: GalleryOp[]; includeFuture?: boolean; onShowOperator?: (id: string) => void; onOpenEvent?: (id: string) => void }) {
  return <Gallery doc={doc as unknown as GalleryDoc} {...props} />;
}
