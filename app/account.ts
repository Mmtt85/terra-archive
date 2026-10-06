// 계정 연동(요스타 로그인) API 클라이언트 — 실제 인증·게임서버 호출은 워커가 한다
// (workers/account: Yostar SDK는 CORS를 주지 않고 요청 서명이 필요해 브라우저에서 직접 못 부른다).
//
// 이 모듈은 상태를 저장하지 않는다. 반환된 token은 호출한 컴포넌트의 메모리에만 두고
// (localStorage 금지 — 계정 접근 권한이 있는 값이다) 탭을 닫으면 사라진다.

const ACCOUNT_API = "https://terra-archive-account.nzkonaru.workers.dev";

// 로컬 개발에서 워커를 직접 띄워 붙일 때: localStorage["terra-account-api"] = "http://localhost:8788"
function apiBase(): string {
  if (typeof window === "undefined") return ACCOUNT_API;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return ACCOUNT_API;
  try {
    return window.localStorage.getItem("terra-account-api") || ACCOUNT_API;
  } catch {
    return ACCOUNT_API;
  }
}

// cn = 중섭 직영(官服) · bili = 중섭 비리비리(B服) — 2026-10-06~. 로그인 방법이 요스타와 달라 폼은 app/account-cn.tsx
export type AccountServer = "kr" | "jp" | "en" | "cn" | "bili";

export const ACCOUNT_SERVERS: { code: AccountServer; label: string }[] = [
  { code: "kr", label: "한국" },
  { code: "jp", label: "일본" },
  { code: "en", label: "글로벌" },
  { code: "cn", label: "중국 (직영)" },
  { code: "bili", label: "중국 (비리비리)" },
];
export const isYostarServer = (server: AccountServer) => server === "kr" || server === "jp" || server === "en";

export type AccountChar = {
  id: string;
  elite: number;
  level: number;
  potential: number;
  skill: number;
  mastery: number[];
  modules: Record<string, number>;
  trust: number;
  skin: string | null;
  /** 아래 셋은 '내 정보' 화면용 — 2026-10-04 이전 워커 응답에는 없다 */
  gain?: number;
  skillIndex?: number;
  equip?: string | null;
};

export type AccountPlayer = {
  nickName: string;
  nickNumber: string;
  uid: string;
  level: number;
  serverName: string;
  lastOnline: number;
};

/** 재동기화용 인증값 — 계정 접근 권한이 있으므로 절대 저장하지 않는다. */
export type AccountToken = { uid: string; token: string; deviceId: string };

/** 친구·지원 유닛의 오퍼 한 칸 */
export type AccountAssist = {
  id: string; elite: number; level: number; potential: number; skin: string | null;
  skillIndex: number; mastery: number[]; skill: number; equip: string | null; equipLevel: number;
};

export type AccountFriend = {
  nickName: string; nickNumber: string; level: number; avatar: string | null;
  secretary: string | null; secretarySkin: string | null; lastOnline: number; resume: string;
  charCnt: number; progress: string | null; assist: AccountAssist[];
};

/** '내 정보' 화면용 계정 요약 (workers/account profile()) — 접근 권한 값은 들어 있지 않다 */
export type AccountProfile = {
  status: {
    level: number; exp: number; ap: number; maxAp: number; apTs: number;
    register: number; lastOnline: number; progress: string | null;
    secretary: string | null; secretarySkin: string | null; avatar: string | null;
    resume: string; friendLimit: number; monthlyEnd: number;
    /** 중섭만 — 순오리지늄이 기기별로 따로다. inventory 4002 는 안드로이드 몫, 이건 iOS 몫 (2026-10-06~ 워커) */
    iosDiamond?: number;
  };
  inventory: Record<string, number>;
  /** 작전 id → 0 해금 · 1 진입 · 2 클리어 · 3 완벽 */
  stages: Record<string, number>;
  campaigns: Record<string, number>;
  recruit: { slot: number; state: number; tags: number[]; picked: number[]; finish: number }[];
  assist: { id: string; skillIndex: number; equip: string | null }[];
  rooms: { slot: string; room: string; level: number }[];
  skins: number;
  medals: number;
  /** 전체 훈장 수 (2026-10-05~ 워커) */
  medalTotal?: number;
  furniture: number;
  /** 친구 목록 — 받아 오지 못했으면 null */
  friends: AccountFriend[] | null;
  /** 정품 인증 서명 — 공유 카드의 QR 이 담는다 ("숫자.서명", 2026-10-05~ 워커) */
  seal?: string | null;
  /** 누적 소비 크레딧 — 크레딧 상점 '오퍼레이터 언락'의 숫자 (2026-10-05~ 워커) */
  creditSpent?: number | null;
  /** 통합전략 테마별 진행 — collect: 갈래 → 얻은 id 들, record: 원본(작으면) (2026-10-05) */
  rogue?: Record<string, { collect: Record<string, string[]>; chat?: { chat?: Record<string, number>; chatV2?: Record<string, string[]> }; record: Record<string, unknown> | null }>;
  /** 연 스토리 — 스토리 id → 그 안의 storyId('<스토리>_' 접두를 뗀 것, 접두가 다르면 '=' + 전체) (2026-10-06~ 워커, 갤러리 스포 방지) */
  stories?: Record<string, string[]>;
};

export type AccountRoster = { player: AccountPlayer; chars: AccountChar[]; token: AccountToken; profile?: AccountProfile };

/** 워커가 돌려준 오류 코드 — 문구는 accountErrorText()가 정한다. */
export class AccountError extends Error {
  constructor(public code: string) { super(code); }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AccountError("offline");
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data || data.ok !== true) throw new AccountError(String(data?.error ?? `http-${res.status}`));
  return data;
}

/** 로그인·동기화 진행 단계 — 워커가 이 순서로 알린다 (2026-10-05) */
export const ACCOUNT_STEPS = [
  { id: "network", label: "서버 주소 확인" },
  { id: "yostar", label: "요스타 인증" },
  { id: "passport", label: "계정 인증" },   // 중섭 — 하이퍼그리프 통행증 / 비리비리
  { id: "game", label: "게임 서버 접속" },
  { id: "sync", label: "계정 데이터 받기 — 오퍼·창고·작전·기지·통합전략" },
  { id: "friends", label: "친구 목록" },
  { id: "shop", label: "크레딧 상점" },
  { id: "digest", label: "정리하기" },
] as const;
export type AccountStep = (typeof ACCOUNT_STEPS)[number]["id"];

/** 진행 단계를 줄 단위(NDJSON)로 받는 요청 — 마지막 줄이 결과다. 옛 워커(JSON 한 덩어리)도 그대로 읽는다. */
async function postStream(path: string, body: Record<string, unknown>, onStep?: (step: AccountStep) => void): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch {
    throw new AccountError("offline");
  }
  if (!res.body || !(res.headers.get("Content-Type") ?? "").includes("ndjson")) {
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || data.ok !== true) throw new AccountError(String(data?.error ?? `http-${res.status}`));
    return data;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let last: Record<string, unknown> | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let row: Record<string, unknown>;
    try { row = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (typeof row.step === "string") onStep?.(row.step as AccountStep);
    else last = row;
  };
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try { chunk = await reader.read(); } catch { throw new AccountError("offline"); }
    if (chunk.done) break;
    buf += chunk.value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(take);
  }
  take(buf);
  const data = last as Record<string, unknown> | null;
  if (!data || data.ok !== true) throw new AccountError(String(data?.error ?? "internal"));
  return data;
}

/** 요스타 계정 이메일로 인증코드를 보낸다. */
export async function sendAccountCode(email: string, server: AccountServer): Promise<void> {
  await post("/send-code", { email: email.trim(), server });
}

/** 인증코드로 로그인해 보유 오퍼 목록을 받는다. **게임 세션이 이 시점에 끊긴다.** */
export async function loginAccount(email: string, code: string, server: AccountServer, onStep?: (step: AccountStep) => void): Promise<AccountRoster> {
  return (await postStream("/login", { email: email.trim(), code: code.trim(), server }, onStep)) as unknown as AccountRoster;
}

/** 이미 받은 토큰으로 다시 동기화 (인증코드 불필요, 역시 게임 세션이 끊긴다). */
export async function syncAccount(token: AccountToken, server: AccountServer, onStep?: (step: AccountStep) => void): Promise<AccountRoster> {
  return (await postStream("/sync", { token, server }, onStep)) as unknown as AccountRoster;
}

/** 공유 카드 정품 인증 — 서명이 맞으면 서명된 그때의 숫자를 돌려준다 */
export type SealData = {
  v: number; server: string; uid: string; nick: string; nickNo: string; level: number; register: number; at: number;
  owned: number; e2: number; e2l90: number; pot6: number; m3: number; skins: number; medals: number;
};
export async function verifySeal(code: string): Promise<SealData | null> {
  const data = await post("/verify", { code, server: "kr" });
  return data.valid === true ? (data.data as SealData) : null;
}

/** 오류 코드를 한국어 원문(i18n 키)으로 — 사전에 같은 키가 있어야 EN/JA가 나온다. */
export function accountErrorText(code: string): string {
  switch (code) {
    case "offline": return "계정 서버에 연결할 수 없습니다 — 잠시 뒤 다시 시도해 주세요.";
    // 요스타는 같은 주소로 곧바로 재요청하면 거절한다 — 직전에 보낸 코드가 아직 유효하다는 뜻
    case "too-many": return "요스타가 코드 재요청을 거절했습니다 — 이미 받은 코드가 있으면 그대로 입력하고, 없으면 1~2분 뒤에 다시 시도해 주세요.";
    case "captcha": return "요스타가 캡차 확인을 요구했습니다 — 잠시 뒤 다시 시도해 주세요.";
    case "no-account": return "그 이메일로 등록된 요스타 계정을 찾지 못했습니다 — 서버 선택과 이메일을 확인해 주세요.";
    case "bad-code": return "인증코드가 맞지 않거나 만료되었습니다 — 코드를 다시 받아 주세요.";
    case "bad-email":
    case "bad-request": return "이메일 형식과 서버 선택을 확인해 주세요.";
    case "token-expired": return "로그인 정보가 만료되었습니다 — 인증코드로 다시 로그인해 주세요.";
    // 중섭 (2026-10-06)
    case "bad-phone": return "휴대폰 번호 형식이 맞지 않습니다 (중국 휴대폰 번호 11자리).";
    case "bad-password": return "아이디 또는 비밀번호가 맞지 않습니다.";
    case "weak-password": return "비리비리가 비밀번호 변경을 요구했습니다 — 비리비리에서 비밀번호를 바꾼 뒤 다시 시도해 주세요.";
    case "bad-token": return "토큰 모양이 아닙니다 — 주소를 연 화면의 글자를 통째로 복사해 붙여넣어 주세요.";
    case "login-failed":
    case "sync-failed": return "게임 서버 로그인에 실패했습니다 — 게임을 완전히 종료한 뒤 다시 시도해 주세요.";
    default: return "계정 연동에 실패했습니다 ({code}) — 잠시 뒤 다시 시도해 주세요.";
  }
}

// ── 중섭(중국 서버) 로그인 (2026-10-06) ──
// 官服은 한국 유저가 중국 휴대폰 문자를 못 받는 게 보통이라 森空岛 QR(scan-start·scan-status → hgToken)이 주 경로, 그다음 통행증 토큰 붙여넣기.
export type CnServer = "cn" | "bili";

export type CnLogin =
  | { server: "cn"; hgToken: string }
  | { server: "cn"; phone: string; code?: string; password?: string }
  | { server: "bili"; username: string; password: string };

/** 중섭 계정으로 로그인해 보유 목록·계정 요약을 받는다 ('내 정보'·인프라 가져오기). **게임 세션이 끊긴다.** */
export async function loginCnAccount(args: CnLogin, onStep?: (step: AccountStep) => void): Promise<AccountRoster> {
  return (await postStream("/login", args, onStep)) as unknown as AccountRoster;
}


/** 직영 QR 로그인 — 森空岛 앱으로 찍을 QR (scanUrl 을 QR 로 그린다) */
export async function startCnScan(): Promise<{ scanId: string; scanUrl: string }> {
  const data = await post("/scan-start", { server: "cn" });
  return { scanId: String(data.scanId), scanUrl: String(data.scanUrl) };
}

/** QR 상태 — done 이면 통행증 토큰(hgToken)이 온다. 몇 초 간격으로 부른다 */
export async function pollCnScan(scanId: string): Promise<{ state: "wait" | "scanned" | "done" | "expired"; hgToken?: string }> {
  const data = await post("/scan-status", { server: "cn", scanId });
  return { state: data.state as "wait" | "scanned" | "done" | "expired", hgToken: typeof data.hgToken === "string" ? data.hgToken : undefined };
}
