"use client";
// PRTS 링크 도움말 모달 — 설명 전용 (연결은 툴바 버튼이 한다). 스샷 레이더 도움말(help.tsx)과
// 같은 껍데기·클래스를 쓴다. 이름은 사용자 지시로 '게임 연결' → 'PRTS 링크'로 바꿈 (2026-07-26):
// 에뮬레이터·PC 클라이언트 화면을 사이트가 실시간으로 읽어 따라가는 기능이라, 로도스 아일랜드의
// 시스템 이름(PRTS)을 빌렸다.

import React, { useEffect } from "react";
import { asset } from "../assets";
import { useI18n, rich } from "../i18n";

export default function BridgeHelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <section className="operator-modal lens-modal" role="dialog" aria-modal="true" aria-label={t("PRTS 링크 도움말")}>
      <header className="scanner-head">
        <h2>◉ {t("PRTS 링크")}<span className="beta-badge">BETA</span></h2>
        <button className="modal-close" onClick={onClose} aria-label={t("닫기")}>✕</button>
      </header>
      <div className="lens-body lens-help">
        <p className="lens-help-intro">{t("에뮬레이터나 PC 클라이언트의 게임 창을 사이트에 물려, 화면이 바뀔 때마다 자동으로 인식해 이 가이드가 따라오게 하는 기능입니다. 스샷 레이더가 '캡처 한 장'을 읽는다면, PRTS 링크는 '보고 있는 화면'을 계속 읽습니다 — 층을 오르는 동안 손댈 일이 없습니다.")}</p>

        <section className="lens-usage" aria-label={t("사용법")}>
          <h3>{t("사용법")}</h3>
          <ol className="lens-usage-steps">
            <li>
              <strong>{t("지금 보는 테마의 PRTS 링크 버튼 누르기")}</strong>
              <span>{t("연결은 테마별입니다 — 사미에서 연결하면 사미 항목만 인식합니다. 다른 테마를 플레이하려면 그 테마에서 다시 연결하세요.")}</span>
            </li>
            <li>
              <strong>{t("공유할 창 고르기")}</strong>
              <span>{t("브라우저가 공유 대상을 물어봅니다. 게임이 돌아가는 에뮬레이터(또는 PC 클라이언트) 창을 고르세요. '창' 단위로 고르면 그 창만 읽으므로 다른 작업이 새지 않습니다.")}</span>
            </li>
            <li>
              <strong>{t("그냥 게임하기")}</strong>
              <span>{t("화면이 바뀌면 알아서 인식하고 해당 정보를 엽니다. 진행 상태는 화면 위쪽 가운데 표시줄에서 볼 수 있습니다.")}</span>
            </li>
            <li>
              <strong>{t("리플레이로 되돌아보기")}</strong>
              <span>{t("연결 중 지나온 여정이 기록됩니다 — '리플레이' 버튼으로 어느 작전에 들어가 결과가 어땠는지, 무슨 소장품을 골랐는지 보고 JSON으로 내보낼 수 있습니다.")}</span>
            </li>
          </ol>
        </section>

        {/* 실사용 예시 — 사용자 실제 화면(2026-07-26 제공): 오른쪽 에뮬레이터가 작전 노드에
            올라가자 왼쪽 사이트가 그 작전 상세를 스스로 열었다 */}
        <h3>{t("이런 식으로 따라옵니다")}</h3>
        <figure className="scanner-sample bridge-sample">
          <img src={asset("/lens/prts-link-sample.webp")} alt={t("에뮬레이터에서 작전 노드를 고르자 사이트가 그 작전 상세를 자동으로 연 화면")} loading="lazy" />
          <figcaption>{t("오른쪽 에뮬레이터에서 '적의 칼로 적 베기' 노드를 고르자, 왼쪽 사이트가 그 작전의 적 구성·지형을 스스로 열었습니다. 위쪽 가운데 표시줄이 연결 상태와 지금 읽은 화면을 알려줍니다.")}</figcaption>
        </figure>

        <h3>{t("무엇이 자동으로 열리나")}</h3>
        <ul>
          <li>{t("맵의 작전 노드 → 해당 작전 상세 (긴급 작전이면 긴급 정보로)")}</li>
          <li>{t("조우·우연한 만남 → 선택지와 결과")}</li>
          <li>{t("전리품·상점 화면 → 해당 소장품 상세, 여러 개면 모아보기")}</li>
          <li>{t("분대·도구·음반 등 → 전시관 해당 탭에서 하이라이트")}</li>
          <li>{t("좌하단 난이도 배지 → 난이도 셀렉터에 자동 반영")}</li>
        </ul>

        <h3>{t("알아두면 좋은 것")}</h3>
        <ul>
          <li>{rich(t("**전투 중에는 일부러 쉽니다.** 전투 화면은 인식 대상이 아니라, 전투에 들어가면 판정을 멈추고 전투가 끝나면 다시 따라옵니다."))}</li>
          <li>{rich(t("**탭을 다른 곳에 두어도 됩니다.** 사이트 탭이 뒤에 있어도 인식은 계속됩니다 — 게임 창과 브라우저를 나란히 놓고 쓰는 것이 가장 편합니다."))}</li>
          <li>{rich(t("**같은 화면을 다시 보면 다시 읽지 않습니다.** 최근에 본 화면은 기억해 두고 그대로 재적용하므로, 지도와 모달을 왕복해도 느려지지 않습니다."))}</li>
          <li>{t("난이도처럼 한 판 안에서 바뀌지 않는 값은 한 번 확정하면 다시 읽지 않습니다. 연결을 끊고 새로 연결하면 초기화됩니다.")}</li>
        </ul>

        <h3>{t("연결을 끊는 방법")}</h3>
        <ul>
          <li>{t("화면 위쪽 표시줄의 '연결 끊기', 또는 테마의 PRTS 링크 버튼을 다시 누르면 끊깁니다.")}</li>
          <li>{t("브라우저가 표시하는 '공유 중지'를 눌러도 됩니다. 탭을 닫거나 새로 고쳐도 연결은 유지되지 않습니다.")}</li>
        </ul>

        <h3>{t("참고")}</h3>
        <ul>
          <li>{rich(t("**아직 BETA입니다.** 화면 인식이 늘 완벽하지는 않습니다 — 엉뚱한 항목이 열리거나 못 읽고 지나갈 수 있습니다. 이상한 판정을 만나면 피드백으로 알려주시면 그 화면을 기준으로 고칩니다."))}</li>
          <li>{rich(t("**화면은 서버로 가지 않습니다.** 인식은 100% 브라우저 안에서 처리되고, 프레임을 저장하거나 녹화하지 않습니다."))}</li>
          <li>{t("화면 공유를 지원하는 데스크톱 브라우저(크롬·엣지 등)에서만 버튼이 보입니다. 모바일에서는 스샷 레이더를 쓰세요.")}</li>
          <li>{t("한국어·영어·일본어 게임 화면을 인식하며, 중국 서버 선행 테마(블랙플로우)는 중국어 화면도 인식합니다.")}</li>
          <li>{t("게임 창이 너무 작거나 가려져 있으면 글자를 못 읽습니다 — 창을 다른 창으로 덮지 마세요.")}</li>
        </ul>
      </div>
    </section>
  );
}
