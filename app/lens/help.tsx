"use client";
// 스샷 레이더 도움말 모달 — 순수 설명 전용 (버튼·입력 기능 없음, 사용자 확정 2026-07-23).
// 실제 입력(클립보드 캡처·드래그앤드롭·⌘V)은 전부 페이지 레벨 자동인식이 처리한다.

import React, { useEffect } from "react";
import { useI18n } from "../i18n";
import type { LensMode } from "./run";

export default function LensHelpModal({ mode, onClose }: { mode: LensMode; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section className="operator-modal lens-modal" role="dialog" aria-modal="true"
      aria-label={mode === "recruit" ? t("스샷 인식 도움말") : t("스샷 레이더 도움말")}>
      <header className="scanner-head">
        <h2>📷 {mode === "recruit" ? t("스샷으로 태그 입력") : t("스샷 레이더")}</h2>
        <button className="modal-close" onClick={onClose} aria-label={t("닫기")}>✕</button>
      </header>
      <div className="lens-body lens-help">
        <p className="lens-help-intro">{mode === "recruit"
          ? t("게임 공개모집 화면의 스크린샷을 인식해, 제시된 태그를 공채 도우미에 자동으로 선택해 주는 기능입니다.")
          : t("게임 통합전략(로그라이크) 화면의 스크린샷을 인식해, 이 가이드의 해당 정보로 바로 이동시켜 주는 기능입니다.")}</p>

        {/* 사용법 — 가장 눈에 띄는 스텝 카드 (사용자 요청 2026-07-24: 사용법을 제일 잘 보이게) */}
        <section className="lens-usage" aria-label={t("사용법")}>
          <h3>{t("사용법")}</h3>
          <ol className="lens-usage-steps">
            <li>
              <strong>{t("📷 버튼으로 자동인식 켜기")}</strong>
              <span>{t("버튼이 켜져 있는 동안만 클립보드를 감시합니다. 기본은 꺼짐이며, 페이지를 새로 고치면 다시 꺼집니다.")}</span>
            </li>
            <li>
              <strong>{t("게임 화면을 클립보드로 캡처")}</strong>
              <span>{t("맥 ⌃⌘⇧4 · 윈도우 Win+Shift+S — 화면 일부만 잘라 찍어도 됩니다.")}</span>
            </li>
            <li>
              <strong>{t("이 탭으로 돌아오기")}</strong>
              <span>{t("자동으로 인식이 시작됩니다. 처음 한 번은 브라우저가 클립보드 접근을 물어보니 '허용'을 눌러주세요.")}</span>
            </li>
            <li>
              <strong>{mode === "recruit" ? t("태그 자동 선택") : t("해당 정보로 자동 이동")}</strong>
              <span>{mode === "recruit"
                ? t("인식되면 태그가 자동으로 선택되고 조합 결과가 바로 계산됩니다 (최대 5개).")
                : t("인식 중에는 상단 알림에 진행 상태와 이미지가 표시되고, 끝나면 해당 정보가 바로 열립니다.")}</span>
            </li>
          </ol>
        </section>

        <h3>{t("다른 입력 방법")}</h3>
        <ul>
          <li>{t("이미지 파일을 화면 아무 곳에나 드래그앤드롭 — 알림을 정확히 조준할 필요 없습니다.")}</li>
          <li>{t("복사해 둔 이미지를 ⌘V(윈도우 Ctrl+V)로 붙여넣기.")}</li>
        </ul>

        {mode === "recruit" ? (
          <>
            <h3>{t("인식 대상")}</h3>
            <ul>
              <li>{t("공개모집의 '모집 요건' 태그 화면 — 태그 버튼이 보이도록 캡처하세요.")}</li>
            </ul>
          </>
        ) : (
          <>
            <h3>{t("인식하는 화면과 동작")}</h3>
            <ul>
              <li>{t("분대 선택 화면 → 전시관 분대 탭으로 이동해 인식된 분대를 전부 하이라이트")}</li>
              <li>{t("전리품(유물) 획득 화면 → 해당 소장품 상세를 바로 열기 (여러 개면 전부 하이라이트)")}</li>
              <li>{t("상인·상점 화면 → 판매 중인 소장품·부품을 전부 모아보기 모달로 표시")}</li>
              <li>{t("맵의 작전 노드 → 해당 작전 상세를 바로 열기")}</li>
              <li>{t("조우(이벤트) 화면 → 해당 조우의 선택지·보상 정보를 바로 열기")}</li>
              <li>{t("도구·음반·영감 등 토픽 고유 항목 → 전시관 해당 탭에서 하이라이트")}</li>
              <li>{t("스크린샷 좌하단에 난이도 배지가 보이면 난이도 셀렉터에도 자동 적용")}</li>
            </ul>
            <h3>{t("테마 판정")}</h3>
            <ul>
              <li>{t("지금 보고 있는 테마를 우선합니다 — 사미 가이드를 보며 찍으면 사미로 판정됩니다.")}</li>
              <li>{t("다른 테마의 확실한 증거(고유 작전명·유물명 등)가 있으면 그 테마로 이동합니다.")}</li>
              <li>{t("화면만으로 테마를 알 수 없으면(분대 이름은 테마 공통) 선택지가 뜹니다.")}</li>
              <li>{t("중국어 화면은 자동으로 침몰자의 흑류수해(CN 선행)로 판정됩니다.")}</li>
            </ul>
          </>
        )}

        <h3>{t("참고")}</h3>
        <ul>
          <li>{t("모든 인식은 100% 브라우저 안에서 처리되며 이미지는 서버로 전송되지 않습니다.")}</li>
          <li>{t("첫 인식은 인식 엔진을 내려받느라 몇 초 더 걸립니다. 이후에는 빨라집니다.")}</li>
          <li>{t("한국어 클라이언트 기준이며, 흑류수해는 중국어(CN) 화면도 인식합니다. 캡처가 선명할수록 정확합니다.")}</li>
        </ul>
      </div>
    </section>
  );
}
