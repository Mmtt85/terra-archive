"use client";

// 파일 저장소 API — 실체는 Cloudflare R2 버킷(terra-archive-files).
// 인증은 Cloudflare Access(구글 SSO)가 담당: 브라우저는 키를 모르고, 같은 오리진
// /api/files(admin-api 프록시 워커)가 JWT 검증 후 키를 붙여 업로드 워커에 중계한다.
// 올린 파일의 공개 URL은 팁 풍선 이미지 등 어디에나 쓸 수 있다.

export const FILES_API = "/api/files";

export type StoredFile = { key: string; size: number; uploaded: string; url: string };

async function parse<T>(res: Response, verb: string): Promise<T> {
  if (res.status === 401) throw new Error("인증 실패 — admin.terra-archive.net에서 구글 로그인 후 이용하세요");
  if (res.status === 413) throw new Error("파일이 너무 큽니다 (95MB 이하)");
  if (!res.ok) throw new Error(`${verb} 실패 (${res.status})`);
  return res.json();
}

/** 파일 이름 → R2 키. URL에 그대로 들어가므로 공백·경로 문자를 정리한다. */
export function safeKey(name: string): string {
  const cleaned = name
    .normalize("NFC") // macOS 한글 파일명은 NFD(자모 분리)로 온다
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^0-9A-Za-z가-힣._-]/g, "")
    .replace(/^[.-]+/, "") // 숨김 파일·상대경로처럼 보이는 키 방지
    .slice(0, 120);
  return cleaned || "file";
}

export async function adminListFiles(): Promise<StoredFile[]> {
  const res = await fetch(FILES_API);
  const data = await parse<{ files: StoredFile[] }>(res, "목록 조회");
  return data.files;
}

/** 업로드 — 같은 이름은 덮어쓴다 (공개 URL 캐시 때문에 반영은 최대 1일). */
export async function adminUploadFile(file: File): Promise<StoredFile> {
  const key = safeKey(file.name);
  const res = await fetch(`${FILES_API}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  return parse<StoredFile>(res, "업로드");
}

export async function adminDeleteFile(key: string): Promise<void> {
  const res = await fetch(`${FILES_API}/${encodeURIComponent(key)}`, { method: "DELETE" });
  await parse(res, "삭제");
}

export const isImageKey = (key: string) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(key);

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
