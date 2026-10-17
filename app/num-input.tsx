"use client";

// 공용 숫자 칸 — [−] [값] [+] (2026-10-17, 사용자 지시 "숫자 입력란 위아래 버튼이 작아 잘 안 눌린다, 사이트 테마에 맞춰 공용으로").
// 브라우저 기본 스핀 단추(작은 ▲▼)는 숨기고 양옆에 칸 높이만 한 단추를 둔다. 색은 버튼 역할 토큰(--btn-*) 그대로.
// 키보드 ↑↓ 는 입력 칸이 그대로 받는다(step 단위). Shift 를 누른 채 단추를 누르면 10배씩. 칸을 누르면 숫자 전체가 선택된다.
import { useI18n } from "./i18n";

export function NumInput({ value, onChange, min = 0, max, step = 1, placeholder, ariaLabel, className }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  placeholder?: string; ariaLabel?: string; className?: string;
}) {
  const { t } = useI18n();
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, Math.floor(v)));
  const bump = (dir: 1 | -1, e: React.MouseEvent) => onChange(clamp((value || 0) + dir * step * (e.shiftKey ? 10 : 1)));
  return (
    <span className={`num-input${className ? ` ${className}` : ""}`}>
      <button type="button" tabIndex={-1} aria-label={t("줄이기")} disabled={(value || 0) <= min} onClick={(e) => bump(-1, e)}>−</button>
      <input type="number" inputMode="numeric" min={min} max={max} step={step} value={value === 0 && placeholder ? "" : value}
        placeholder={placeholder} aria-label={ariaLabel}
        // 누르면 숫자 전체 선택 — 바로 새 값을 치게 (사용자 지시 2026-10-17). 포커스 직후 마우스 떼기가 선택을 풀어 한 박자 뒤에 고른다
        onFocus={(e) => { const el = e.currentTarget; requestAnimationFrame(() => el.select()); }}
        // 숫자만 — number 칸도 e·+·-·. 은 받아서 막는다 (사용자 지시 2026-10-17). 단축키(복사·붙여넣기·전체 선택)와 화살표·지우기는 그대로
        onKeyDown={(e) => { if (e.key.length === 1 && !/[0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
        onPaste={(e) => { const v = e.clipboardData.getData("text"); if (!/^\d+$/.test(v.trim())) { e.preventDefault(); const n = v.replace(/\D/g, ""); if (n) onChange(clamp(Number(n))); } }}
        onChange={(e) => onChange(e.target.value === "" ? 0 : clamp(Number(e.target.value) || 0))} />
      <button type="button" tabIndex={-1} aria-label={t("늘리기")} disabled={max != null && (value || 0) >= max} onClick={(e) => bump(1, e)}>+</button>
    </span>
  );
}
