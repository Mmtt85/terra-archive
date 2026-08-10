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
  /** 드랍 [아이템id, occ번호, kinds번호, 실측%?, 효율순위?, 순위모수?] */ d?: (string | number)[][];
  /** 등장 적 [enemyIds번호, 스폰수, 스탯레벨] */ e?: [number, number, number][];
  /** events 배열 번호 — 이벤트 작전만 있다 */ ev?: number;
  /** 도면 보유 (없으면 키 자체가 없다) */ map?: number;
  /** 고난 판 배열 번호 — 상세의 환경 탭이 이 레코드로 통째로 갈아끼운다 */ alt?: number;
  /** (고난 판만) 일반판 배열 번호 — 딥링크가 오면 일반판 상세를 고난 탭으로 연다 */ base?: number;
  /** (고난 판만) 목록·사이트맵에서 숨김 */ sub?: number;
  /** 긴급 작전 제한 조건 — 지형·등장 적은 일반판과 같아 텍스트만 있다 */ chg?: string;
  /** 적 스탯 배수 [hp,atk,def,res, 대상적id들|0][] — 룬 유래 (stage-env.json 머리주석) */ em?: EnvMul[];
  /** 긴급 모드의 적 스탯 배수 — chg와 함께 다닌다 */ chgEm?: EnvMul[];
};
export type EnvMul = [number, number, number, number, string | 0];
export type StageDoc = {
  zones: string[]; events: string[]; items: Record<string, string>; occ: string[]; kinds: string[];
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
  drops: { id: string; name: string; occ: string; kind: string; rate?: number; rank?: number; rankOf?: number }[];
  enemies: { id: string; name: string; cnt: number; lv: number; st?: [number, number, number, number] }[];
  /** 고난 판 전체 뷰 — 환경 탭이 도면·적·드랍을 통째로 이걸로 바꾼다 */ alt?: StageView;
  /** 1이면 고난 탭을 켠 채로 연다 (고난 id 딥링크로 들어온 경우) */ initEnv?: 1;
};

/** enemy-stats.json — { 적id: [[강화단계, hp, atk, def, res] …] } (build-enemies.py 산출) */
export type EnemyStatsIndex = Record<string, number[][]>;

/** 고난 id로 들어와도 **일반판 상세**를 돌려준다 — 목록·페이지가 한 벌로 두 환경을 그린다 */
export function viewOf(doc: StageDoc, stage: Stage, stats?: EnemyStatsIndex): StageView {
  if (stage.base !== undefined) {
    const b = doc.stages[stage.base];
    return { ...coreView(doc, b, stats), alt: coreView(doc, stage, stats), initEnv: 1 };
  }
  const v = coreView(doc, stage, stats);
  if (stage.alt !== undefined) v.alt = coreView(doc, doc.stages[stage.alt], stats);
  return v;
}

function coreView(doc: StageDoc, stage: Stage, stats?: EnemyStatsIndex): StageView {
  return {
    stage,
    zone: doc.zones[stage.z] ?? "",
    typeName: doc.types[stage.t] ?? stage.t,
    drops: (stage.d ?? []).map((row) => {
      const [id, o, k, rate, rank, rankOf] = row as [string, number, number, number?, number?, number?];
      return {
        id, name: doc.items[id] ?? id, occ: doc.occ[o] ?? "", kind: doc.kinds[k] ?? "",
        // 펭귄 물류 실측 — 주요 드랍 재료 316쌍에만 있다 (build-stages.py MEASURED)
        ...(rate !== undefined ? { rate, rank, rankOf } : {}),
      };
    }),
    enemies: (stage.e ?? []).map(([i, cnt, lv]) => {
      const id = doc.enemyIds[i];
      // 그 작전이 쓰는 강화 단계의 코어 스탯 — 단계가 색인에 없으면 기본형(첫 행)으로
      const rows = stats?.[id];
      const row = rows?.find((r) => r[0] === lv) ?? rows?.[0];
      return {
        id, name: doc.enemyNames[id] ?? id, cnt, lv,
        ...(row ? { st: [row[1], row[2], row[3], row[4]] as [number, number, number, number] } : {}),
      };
    }),
  };
}
