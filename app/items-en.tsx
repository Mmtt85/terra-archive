"use client";

// 로케일별 아이템 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/enemies-en.tsx와 같은 관례).
// 한 모듈에서 세 로케일을 동적 선택하면 셋 다 같은 청크에 묶여 1.9MB가 된다.
import ItemDex, { type ItemDoc } from "./items";
import doc from "./data/items.en.json";

export default function ItemDexEN() {
  return <ItemDex doc={doc as unknown as ItemDoc} />;
}
