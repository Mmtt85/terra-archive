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

export type AccountServer = "kr" | "jp" | "en";

export const ACCOUNT_SERVERS: { code: AccountServer; label: string }[] = [
  { code: "kr", label: "한국" },
  { code: "jp", label: "일본" },
  { code: "en", label: "글로벌" },
];

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

export type AccountRoster = { player: AccountPlayer; chars: AccountChar[]; token: AccountToken };

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

/** 요스타 계정 이메일로 인증코드를 보낸다. */
export async function sendAccountCode(email: string, server: AccountServer): Promise<void> {
  await post("/send-code", { email: email.trim(), server });
}

/** 인증코드로 로그인해 보유 오퍼 목록을 받는다. **게임 세션이 이 시점에 끊긴다.** */
export async function loginAccount(email: string, code: string, server: AccountServer): Promise<AccountRoster> {
  return (await post("/login", { email: email.trim(), code: code.trim(), server })) as unknown as AccountRoster;
}

/** 이미 받은 토큰으로 다시 동기화 (인증코드 불필요, 역시 게임 세션이 끊긴다). */
export async function syncAccount(token: AccountToken, server: AccountServer): Promise<AccountRoster> {
  return (await post("/sync", { token, server })) as unknown as AccountRoster;
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
    case "login-failed":
    case "sync-failed": return "게임 서버 로그인에 실패했습니다 — 게임을 완전히 종료한 뒤 다시 시도해 주세요.";
    default: return "계정 연동에 실패했습니다 ({code}) — 잠시 뒤 다시 시도해 주세요.";
  }
}
