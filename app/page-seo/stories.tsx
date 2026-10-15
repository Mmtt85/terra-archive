// 스토리 목록 서버 안내 — 푸터 위 접는 칸 (2026-10-15). 목록 화면은 요약 JSON 을 브라우저에서 받아 그려,
// 서버 HTML 에는 스토리 이름이 하나도 없었다(본문 65자). 상세 페이지로 가는 링크가 HTML 에 있어야 검색엔진이 상세를 따라 들어간다. 세 언어
import { storyListFor } from "../seo-story";
import { BASE, type SeoLang } from "./locale";

const T = {
  ko: { aria: "스토리 목록", summary: (n: number) => `명일방주 스토리 요약 목록 — ${n}편`, p: "명일방주 메인 스토리·사이드 스토리·통합전략 스토리를 원문을 읽고 컷씬과 함께 정리한 요약입니다. 이름을 누르면 요약으로 갑니다.", lore: "이벤트 기록" },
  en: { aria: "Story list", summary: (n: number) => `Arknights story summaries — ${n} stories`, p: "Summaries of Arknights main, side and Integrated Strategies stories, written from the original script with the cutscenes. Open a title to read its summary.", lore: "event records" },
  ja: { aria: "ストーリー一覧", summary: (n: number) => `アークナイツ ストーリー要約一覧 — ${n}編`, p: "アークナイツのメインストーリー・サイドストーリー・統合戦略のストーリーを、原文を読んでカットシーンとともにまとめた要約です。タイトルを押すと要約が開きます。", lore: "イベント記録" },
};

export default function StoriesSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = T[lang];
  const list = storyListFor(lang);
  return (
    <section className="page-seo" aria-label={L.aria}>
      <details>
        <summary>{L.summary(list.filter((s) => !s.lore).length)}</summary>
        <p>{L.p}</p>
        <ul>
          {list.map((s) => (
            <li key={s.id}><a href={`${BASE[lang]}/stories/${s.id}`}>{s.name}</a>{s.start ? ` (${s.start.replace("-", ".")})` : ""}{s.lore ? ` — ${L.lore}` : s.tagline ? ` — ${s.tagline}` : ""}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
