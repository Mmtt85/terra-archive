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
  /** 고난(·보안 파견 긴급) 판 배열 번호 — 상세의 환경 탭이 이 레코드로 통째로 갈아끼운다 */ alt?: number;
  /** (숨은 판만) 일반판 배열 번호 — 딥링크가 오면 일반판 상세를 해당 환경 탭으로 연다 */ base?: number;
  /** (숨은 판만) 목록·사이트맵에서 숨김 */ sub?: number;
  /** alt가 고난이 아니라 **긴급** 판 (보안 파견 `_ex`) — 상세 탭 라벨이 '긴급 환경'이 된다 */ ae?: number;
  /** 긴급 환경 안내 텍스트 — 일반판 행이면 #f# 제한 조건, 보안 파견 `_ex` 행이면
   *  긴급 보급 조건·위험 등급 효과 (둘 다 긴급 환경 탭에서 빨간 박스로 나온다) */ chg?: string;
  /** 적 스탯 배수 [hp,atk,def,res, 대상적id들|0][] — 룬 유래 (stage-env.json 머리주석) */ em?: EnvMul[];
  /** 긴급 모드의 적 스탯 배수 — chg와 함께 다닌다 */ chgEm?: EnvMul[];
  /** 통합전략 작전 — 도면·이동 경로의 **출처가 다르다** (public/rogue/map · rogue-routes.json).
   *  scripts/build-stages-rogue.py 산출물에만 붙는다 */ rg?: 1;
  /** (통합전략만) 작전 종류 라벨 — 이성·보상이 없는 자리를 대신한다 (작전/긴급 작전/시련…) */ kind?: string;
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

/**
 * 통합전략 색인(stages-rogue*.json)을 본 문서 뒤에 이어 붙인다 — 목록 탭 전용.
 *
 * 두 문서는 각자 자기 사전(zones·events·enemyIds…)으로 번호를 매기고 있어, 그냥 stages만
 * 합치면 번호가 엉뚱한 값을 가리킨다. 그래서 사전을 이어 붙이고 록라 쪽 번호를 **오프셋만큼
 * 밀어** 재매핑한다 (693건 · 1회 — 비용 무시 가능).
 *
 * ⚠ 서버(app/seo-stage.ts)·사이트맵은 이 함수를 쓰지 않는다 — 통합전략은 파일 수 한도 때문에
 *   개별 상세 페이지를 갖지 않는다 (근거: scripts/build-stages-rogue.py 머리주석).
 */
export function mergeRogueDoc(base: StageDoc, rogue: StageDoc): StageDoc {
  const zOff = base.zones.length, evOff = base.events.length, enOff = base.enemyIds.length;
  return {
    ...base,
    zones: [...base.zones, ...rogue.zones],
    events: [...base.events, ...rogue.events],
    enemyIds: [...base.enemyIds, ...rogue.enemyIds],
    types: { ...base.types, ...rogue.types },
    // 같은 적이 양쪽에 있으면 **본 도감 이름을 정본으로** 둔다 (록라 데이터는 뒤에 깔린다)
    enemyNames: { ...rogue.enemyNames, ...base.enemyNames },
    stages: [...base.stages, ...rogue.stages.map((s) => ({
      ...s,
      z: s.z + zOff,
      ...(s.ev !== undefined ? { ev: s.ev + evOff } : {}),
      ...(s.e ? { e: s.e.map(([i, cnt, lv]) => [i + enOff, cnt, lv] as [number, number, number]) } : {}),
    }))],
  };
}

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
