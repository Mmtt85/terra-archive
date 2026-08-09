// 작전 도감 데이터의 타입과 변환 — **서버·클라이언트 공용이라 "use client"가 없다.**
//
// ⚠ viewOf를 app/stage-detail.tsx("use client")에 두었더니 빌드가
//   `Unexpectedly client reference export 'viewOf' is called on server`로 죽었다
//   (2026-08-09). 상세 라우트(app/seo-stage.ts)는 **서버에서** 이걸 불러 그 작전 하나를
//   풀어 props로 내려 준다 — 그래서 순수 데이터 모듈로 갈라 둔다.

/** scripts/build-stages.py 산출물 — 반복 값은 위쪽 사전으로 빼고 본문은 번호로 가리킨다 */
export type Stage = {
  id: string; code: string; name: string;
  /** zones 배열 번호 */ z: number;
  /** stageType (MAIN·ACTIVITY…) */ t: string;
  desc?: string; ap?: number; exp?: number; gold?: number; danger?: string;
  /** 드랍 [아이템id, occ번호, kinds번호] */ d?: [string, number, number][];
  /** 등장 적 [enemyIds번호, 스폰수, 스탯레벨] */ e?: [number, number, number][];
  /** 도면 보유 (없으면 키 자체가 없다) */ map?: number;
};
export type StageDoc = {
  zones: string[]; items: Record<string, string>; occ: string[]; kinds: string[];
  enemyIds: string[]; types: Record<string, string>; enemyNames: Record<string, string>;
  stages: Stage[];
};

/**
 * 상세 본문에 필요한 조각만 담은 묶음. 상세 **페이지**는 서버가 이 형태로 내려 주고
 * (전체 사전 1.25MB를 페이지마다 직렬화하지 않기 위해), 목록 모달은 자기 문서에서 뽑아 만든다.
 */
export type StageView = {
  stage: Stage;
  zone: string;
  typeName: string;
  drops: { id: string; name: string; occ: string; kind: string }[];
  enemies: { id: string; name: string; cnt: number; lv: number }[];
};

export function viewOf(doc: StageDoc, stage: Stage): StageView {
  return {
    stage,
    zone: doc.zones[stage.z] ?? "",
    typeName: doc.types[stage.t] ?? stage.t,
    drops: (stage.d ?? []).map(([id, o, k]) => ({
      id, name: doc.items[id] ?? id, occ: doc.occ[o] ?? "", kind: doc.kinds[k] ?? "",
    })),
    enemies: (stage.e ?? []).map(([i, cnt, lv]) => {
      const id = doc.enemyIds[i];
      return { id, name: doc.enemyNames[id] ?? id, cnt, lv };
    }),
  };
}
