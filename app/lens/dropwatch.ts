"use client";
// 파일 드래그앤드롭 감시 훅 — 스샷 레이더 자동인식이 켜진 동안 "창 전체"를 드롭존으로 만든다.
// 필(작은 알림)을 정확히 조준하지 않아도 되고, dragover 미취소로 브라우저가 이미지를
// 열어버리는 사고도 막는다. 반환값 = 지금 파일을 드래그 중인지 (필 하이라이트용).

import { useEffect, useRef, useState } from "react";

export function useDropWatch(enabled: boolean, onImage: (file: File) => Promise<void> | void): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onImage);
  useEffect(() => { cb.current = onImage; });

  useEffect(() => {
    if (!enabled) return;
    let depth = 0; // dragenter/leave는 자식 요소마다 발화 — 카운터로 실제 이탈 판정
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; setDragging(true); };
    const onLeave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); };
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); }; // 취소해야 drop이 발화한다
    const onDrop = (e: DragEvent) => {
      depth = 0; setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) void cb.current(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      setDragging(false);
    };
  }, [enabled]);

  return dragging;
}
