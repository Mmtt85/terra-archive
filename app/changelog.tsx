"use client";

// 업데이트 내역 — 헤더 버튼 + 모달 (사용자 요청 2026-07-26).
// 커밋 로그를 그대로 뿌리지 않고, 사용자 눈에 보이는 변화만 날짜별로 큐레이션해 담는다.
// 새 배포를 하면 이 목록 맨 위에 항목을 추가하면 된다 — 문구는 i18n 키이므로
// app/i18n.tsx 사전에 EN/JA 짝을 함께 넣어야 한다 (CLAUDE.md 규칙).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";
import { useHashSync } from "./hash-modal";

type Kind = "new" | "improve" | "fix";

// href = 로케일 제외 사이트 경로 (ko는 그대로, en/ja는 접두). omni = 헤더 만능검색 열기
type Entry = { kind: Kind; text: string; href?: string; omni?: boolean };
type DayGroup = { date: string; label: string; entries: Entry[] };

const KIND_LABEL: Record<Kind, string> = { new: "신기능", improve: "개선", fix: "수정" };

// 최신이 위 — 2026-07-24 17:00 KST 이후 배포분
const CHANGELOG: DayGroup[] = [
  {
    date: "2026-07-26",
    label: "2026년 7월 26일",
    entries: [
      { kind: "new", text: "보유 오퍼레이터 가져오기 — 직접 입력 외에 MAA 파일·스크린샷·게임 계정 로그인 3가지 방식이 생겼습니다. 요스타 계정으로 로그인하면 실제 보유 목록을 통째로 동기화합니다.", href: "/infra#roster-import" },
      { kind: "new", text: "PRTS 링크 (BETA) — 통합전략 가이드에서 게임 화면을 실시간으로 연결하면 조우·소장품·작전을 자동 인식해 해당 정보로 이동합니다. 자세한 사용법은 버튼 옆 ? 도움말에.", href: "/rogue#prts-help" },
      { kind: "new", text: "리플레이 — PRTS 링크로 플레이한 여정(작전 진입·조우·소장품 획득)이 자동 기록됩니다. 프리뷰로 훑어보고 JSON으로 내보내기·가져오기가 됩니다.", href: "/rogue#replay" },
      { kind: "improve", text: "유니버셜 서치 — 검색창 폭을 정리하고, 실패한 검색어가 재검색 끝에 고른 결과와 즉시 짝지어지도록 학습을 강화했습니다." },
      { kind: "improve", text: "보유 오퍼레이터 설정 모달이 가벼워졌습니다 — 카드를 눌렀을 때 전체가 다시 그려지던 문제를 없앴습니다." },
      { kind: "improve", text: "사이트 전역의 버튼·카드·모달 모서리를 통일감 있게 둥글렸습니다." },
      { kind: "improve", text: "통합전략 가이드 — 시비경·금석경의 시련 작전을 채우고, 짙푸른 요람에 원더랜드 배지를 달았습니다." },
      { kind: "fix", text: "이름 정리 — 메뉴 '소개'는 '테라 아카이브 소개'로, 검색어 '인프라 딸깍'으로도 인프라 자동편성기에 들어갑니다." },
    ],
  },
  {
    date: "2026-07-25",
    label: "2026년 7월 25일",
    entries: [
      { kind: "new", text: "만능검색 — 헤더 검색창에서 단어 하나로 사이트 안 아무 컨텐츠나 찾아 이동합니다. 오탈자 근사·은어 별칭을 알아듣고, 선택할수록 똑똑해집니다.", omni: true },
      { kind: "new", text: "스샷 레이더가 일본어·영어 게임 화면도 인식합니다 (KR 전용 → KR/EN/JA).", href: "/rogue" },
      { kind: "improve", text: "공식 방송 — 버튼을 미래시 토글 옆으로 옮기고, 지난 방송 10건 이력을 담았습니다. 미래시를 켜면 중국 서버(비리비리) 일정도 보입니다." },
      { kind: "improve", text: "헤더 이벤트 드롭다운에 '향후 다가올 이벤트'를 추가하고, 미실장 이벤트에 KR 추정 출시월을 표시합니다." },
      { kind: "improve", text: "인프라 자동편성기 — 숙소 직접 편성과 📌 고정, 파트너·이름 조건 오판 전수 정정, 육성 추천이 안 뜨던 원인 수정, 스킬 설명 속 RIIC 용어 클릭 팝업(79종)." },
      { kind: "improve", text: "스토리 — 본문의 점선 밑줄 단어를 누르면 인물·용어 팝오버가 뜹니다. 화자와 스탠딩 CG가 어긋나던 장면도 전수 정정했습니다." },
    ],
  },
  {
    date: "2026-07-24",
    label: "2026년 7월 24일 (17시 이후)",
    entries: [
      { kind: "improve", text: "통합전략 가이드 — 사미 암호판을 보유 리스트 수집 자원으로, 붕괴 패러다임을 1·2단계 카드로, 화룡점정 조우 트리를 큐레이션했습니다." },
      { kind: "improve", text: "스크린샷 스캐너가 iPad(4:3) 화면도 인식합니다." },
      { kind: "improve", text: "인프라 자동편성기 — 왕 '임기응변'의 외세·실리 분기, 왕 착석→슈 해방 교차방 사슬 평가 등 편성 정확도를 올렸습니다." },
    ],
  },
];

export default function ChangelogButton() {
  const { locale, t } = useI18n();
  const localeBase = locale === "ko" ? "" : `/${locale}`;
  const [open, setOpen] = useState(false);
  // 기본은 신기능만 — 개선·수정은 '상세보기'를 눌러야 펼친다 (사용자 요청 2026-07-27)
  const [detail, setDetail] = useState(false);
  // 딥링크: #changelog(신기능만) · #changelog-all(상세) — 어느 탭에서든 열린다
  useHashSync(open ? (detail ? "#changelog-all" : "#changelog") : null, (h) => {
    if (h === "#changelog" || h === "#changelog-all") { setOpen(true); setDetail(h === "#changelog-all"); }
    else setOpen(false);
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      {/* 버튼으로 열 땐 항상 신기능만부터 — 딥링크(#changelog-all)로는 상세로 바로 진입 */}
      <button type="button" className="chlog-trigger" onClick={() => { setDetail(false); setOpen(true); }} title={t("최근 업데이트 내역 보기")}>
        <span aria-hidden>🛠</span>
        <span>{t("업데이트 내역")}</span>
      </button>
      {/* 헤더의 backdrop-filter가 fixed 기준을 헤더로 만들어버리므로 portal로 body에 렌더 */}
      {open && createPortal(
        <div className="modal-backdrop chlog-backdrop" onClick={() => setOpen(false)}>
          <div className="chlog-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("업데이트 내역")}>
            <header>
              <h2>🛠 {t("업데이트 내역")}</h2>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={t("닫기")}>×</button>
            </header>
            <div className="chlog-list">
              {CHANGELOG.map((day) => {
                const entries = detail ? day.entries : day.entries.filter((e) => e.kind === "new");
                if (entries.length === 0) return null; // 신기능이 없는 날은 상세보기 전엔 통째로 숨김
                return (
                  <section key={day.date}>
                    <h3>{t(day.label)}</h3>
                    <ul>
                      {entries.map((entry, i) => (
                        <li key={i}>
                          <span className={`chlog-kind ${entry.kind}`}>{t(KIND_LABEL[entry.kind])}</span>
                          <span className="chlog-text">
                            {t(entry.text)}
                            {entry.href && (
                              <a className="chlog-go" href={`${localeBase}${entry.href}`}>{t("바로가기")} →</a>
                            )}
                            {entry.omni && (
                              // 만능검색은 페이지가 아니라 헤더 기능 — 모달을 닫고 검색창을 연다
                              <button type="button" className="chlog-go" onClick={() => {
                                setOpen(false);
                                document.querySelector<HTMLButtonElement>(".omni-trigger")?.click();
                              }}>{t("바로가기")} →</button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <button type="button" className="chlog-detail-btn" onClick={() => setDetail((d) => !d)}>
                {detail ? t("신기능만 보기") : t("상세보기 — 개선·수정 내역까지")}
              </button>
              {/* 후원 안내 — 상세보기와 무관하게 항상 보이는 하단 노트 (사용자 요청 2026-07-27) */}
              <p className="chlog-donate">
                ☕ {t("사이트 후원 버튼도 달았습니다 — 광고 없이 운영되는 사이트라, 후원해 주시면 서버·도메인 비용에 큰 힘이 됩니다. 감사하겠습니다!")}{" "}
                <a href="https://buymeacoffee.com/terra_archive" target="_blank" rel="noopener noreferrer">{t("서버 운영 후원")}</a>
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
