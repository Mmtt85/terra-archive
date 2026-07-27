"use client";

// 파일 저장소 API — 실체는 Cloudflare R2 버킷(terra-archive-files)이고
// 업로드·목록·삭제는 workers/upload 워커를 거친다 (x-admin-key = /admin 입장 비밀번호).
// 올린 파일의 공개 URL(<워커>/f/<key>)은 팁 풍선 이미지 등 어디에나 쓸 수 있다.

export const FILES_API = "https://terra-archive-upload.nzkonaru.workers.dev";

export type StoredFile = { key: string; size: number; uploaded: string; url: string };

const auth = (password: string) => ({ "x-admin-key": password });

async function parse<T>(res: Response, verb: string): Promise<T> {
  if (res.status === 401) throw new Error("비밀번호가 틀립니다 — 워커 ADMIN_KEY 시크릿과 /admin 비밀번호가 같아야 합니다");
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

export async function adminListFiles(password: string): Promise<StoredFile[]> {
  const res = await fetch(`${FILES_API}/files`, { headers: auth(password) });
  const data = await parse<{ files: StoredFile[] }>(res, "목록 조회");
  return data.files;
}

/** 업로드 — 같은 이름은 덮어쓴다 (공개 URL 캐시 때문에 반영은 최대 1일). */
export async function adminUploadFile(password: string, file: File): Promise<StoredFile> {
  const key = safeKey(file.name);
  const res = await fetch(`${FILES_API}/files/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { ...auth(password), "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  return parse<StoredFile>(res, "업로드");
}

export async function adminDeleteFile(password: string, key: string): Promise<void> {
  const res = await fetch(`${FILES_API}/files/${encodeURIComponent(key)}`, { method: "DELETE", headers: auth(password) });
  await parse(res, "삭제");
}

export const isImageKey = (key: string) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(key);

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
