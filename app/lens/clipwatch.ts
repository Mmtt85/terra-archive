"use client";
// 클립보드 이미지 감시 훅 — 스샷 레이더 모달·페이지 레벨 자동인식 토글이 공유.
// 스캐너 v6과 동일 패턴: 권한 granted면 1초 폴링, prompt면 1회 read()로 권한 유도,
// denied/미지원이면 "off"(⌘V·드롭 폴백 안내). 같은 클립보드는 크기+샘플 바이트 해시로 스킵.

import { useEffect, useRef, useState } from "react";

export type ClipState = "idle" | "on" | "off";

export function useClipboardWatch(enabled: boolean, onImage: (file: File) => Promise<void> | void): ClipState {
  const [clip, setClip] = useState<ClipState>("idle");
  const lastHash = useRef("");
  const busy = useRef(false);
  const cb = useRef(onImage);
  useEffect(() => { cb.current = onImage; });

  // ⌘V 붙여넣기 — 자동 읽기가 막힌 환경(사파리 등)의 폴백. 폴링과 같은 콜백으로 합류.
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .find((f): f is File => !!f);
      if (!file || busy.current) return;
      e.preventDefault();
      busy.current = true;
      void (async () => {
        try { await cb.current(file); } finally { busy.current = false; }
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let iv: number | undefined;
    let disposed = false;

    const tick = async () => {
      if (disposed || busy.current || !document.hasFocus()) return;
      try {
        const items = await navigator.clipboard.read();
        if (disposed) return;
        setClip("on");
        for (const it of items) {
          const type = it.types.find((tp) => tp.startsWith("image/"));
          if (!type) continue;
          const blob = await it.getType(type);
          const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
          let h = `${blob.size}:${type}:`;
          for (let i = 0; i < head.length; i += 997) h += head[i].toString(36);
          if (h === lastHash.current) continue;
          lastHash.current = h;
          busy.current = true;
          try { await cb.current(new File([blob], "clipboard", { type })); }
          finally { busy.current = false; }
        }
      } catch {
        if (!disposed) setClip((c) => (c === "on" ? "on" : "off"));
      }
    };
    const startPolling = () => { if (iv === undefined) iv = window.setInterval(() => { void tick(); }, 1000); };

    (async () => {
      try {
        const st = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        const apply = () => {
          if (disposed) return;
          if (st.state === "granted") { setClip("on"); startPolling(); }
          else if (st.state === "prompt") { void tick(); }
          else setClip("off");
        };
        st.addEventListener("change", apply);
        apply();
      } catch {
        await tick();
        if (!disposed) startPolling();
      }
    })();

    return () => { disposed = true; if (iv !== undefined) clearInterval(iv); setClip("idle"); };
  }, [enabled]);

  return clip;
}
