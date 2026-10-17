// 공채 페이지 서버 안내 — 푸터 위 접는 칸 (2026-10-15).
// 계산기(app/recruit.tsx)는 지연 로드라 서버가 만든 HTML 에 태그도 설명도 없어(본문 대부분이 사이트 메뉴), "명방 공채"·"공개모집 계산기"
// 검색에서 공개모집 페이지로 읽히지 않았다(사용자 지적 — 미나세 공채 계산기는 태그 이름과 사용법 몇 줄이 HTML 에 있어 걸린다).
// 서버 컴포넌트라 이 칸은 자바스크립트로 실려 가지 않는다 — 다른 화면 용량과 무관. 문구는 계산기 도움말과 같은 내용. 세 언어
import { SNIPE_DICT, TAG_GROUPS, data, type ComboResult } from "../recruit-core";
import { opName, tagName, SEO_LABEL, type SeoLang } from "./locale";

const TAG_ID = new Map(data.tags.map((t) => [t.name, t.id]));

const T = {
  ko: {
    aria: "공개모집 계산기 안내", summary: "공개모집 계산기 사용 방법 · 고성급 확정 태그 조합", how: "사용 방법",
    p1: <>흔히 공채라고 부르는 공개모집에 <b>제시된 태그 5개</b>를 위 계산기에 그대로 입력하세요. 실제 게임에서 체크할 수 있는 <b>최대 3개</b>짜리 조합 전부를 계산해,
      높은 성급이 확정되는 조합부터 순서대로 보여 줍니다. 성급은 모집 시간 <b>9시간</b> 기준이고, 6★는 고급 특별 채용 태그가 있어야 나옵니다.</>,
    p2: <><b>모집 시간별 출현 성급</b> — 1시간~3시간 50분: 1·2·3·4★ · 4시간~7시간 30분: 2·3·4·5★ · 7시간 40분 이상: 3·4·5★만 나옵니다.
      고성급을 노리는 조합은 <b>7시간 40분 이상(보통 9시간)</b>으로 돌려야 3★ 미만이 섞이지 않습니다.</>,
    p3: "게임 화면 스크린샷을 붙여 넣거나 끌어다 놓으면 태그를 자동으로 읽어 입력합니다. 오퍼레이터를 고르면 그 오퍼가 나오는 태그 조합도 거꾸로 찾아 줍니다.",
    tags: "공개모집 태그 목록", groups: { 자격: "자격 태그", 직군: "직군 태그", 위치: "위치 태그", 특성: "특성 태그" } as Record<string, string>,
    five: "5★ 확정 태그 조합", fiveP: "특별 채용·고급 특별 채용 없이도 5★ 이상이 확정되는 최소 조합입니다.",
    four: "4★ 이상 확정 태그 조합", fourP: "모집 태그에 아래 조합이 뜨면 놓치지 마세요. 태그를 더 얹어도 확정은 유지됩니다.",
    star: (lo: number, hi: number) => (lo === hi ? `${lo}★ 확정` : `${lo}★ 이상 확정`),
  },
  en: {
    aria: "Recruitment calculator guide", summary: "How to use the Recruitment calculator · Guaranteed high-rarity tag combos", how: "How to use",
    p1: <>Enter the <b>five tags</b> offered in the game&rsquo;s Recruitment into the calculator above. It checks every combo of <b>up to three tags</b> you can pick in game
      and lists the ones that guarantee the highest rarity first. Rarities assume a <b>9-hour</b> recruitment; 6★ only appears with the Top Operator tag.</>,
    p2: <><b>Rarity by recruitment time</b> — 1:00–3:50: 1·2·3·4★ · 4:00–7:30: 2·3·4·5★ · 7:40 or longer: 3·4·5★ only.
      Run high-rarity combos at <b>7:40 or longer (usually 9:00)</b> so nothing below 3★ slips in.</>,
    p3: "Paste or drop a screenshot of the game screen to read the tags automatically. Pick an operator to look up the tag combos that can give you that operator.",
    tags: "Recruitment tags", groups: { 자격: "Qualification", 직군: "Class", 위치: "Position", 특성: "Affix" } as Record<string, string>,
    five: "Guaranteed 5★ combos", fiveP: "The smallest combos that guarantee 5★ or higher without Senior or Top Operator.",
    four: "Guaranteed 4★+ combos", fourP: "Don't skip these when they show up. Adding more tags keeps the guarantee.",
    star: (lo: number, hi: number) => (lo === hi ? `${lo}★ guaranteed` : `${lo}★+ guaranteed`),
  },
  ja: {
    aria: "公開求人計算機の案内", summary: "公開求人計算機の使い方・高レア確定タグの組み合わせ", how: "使い方",
    p1: <>ゲームの公開求人で<b>提示された5つのタグ</b>を上の計算機にそのまま入力してください。ゲームで選べる<b>最大3つ</b>までの組み合わせをすべて計算し、
      高いレアリティが確定する組み合わせから順に表示します。レアリティは求人時間<b>9時間</b>が前提で、★6は上級エリートのタグがあるときだけ出ます。</>,
    p2: <><b>求人時間ごとの出現レアリティ</b> — 1時間〜3時間50分: ★1・2・3・4 · 4時間〜7時間30分: ★2・3・4・5 · 7時間40分以上: ★3・4・5のみ。
      高レア狙いの組み合わせは<b>7時間40分以上（ふつうは9時間）</b>で回すと★3未満が混ざりません。</>,
    p3: "ゲーム画面のスクリーンショットを貼り付けるかドロップすると、タグを自動で読み取って入力します。オペレーターを選ぶと、そのオペレーターが出るタグの組み合わせも逆引きできます。",
    tags: "公開求人タグ一覧", groups: { 자격: "資格タグ", 직군: "職業タグ", 위치: "位置タグ", 특성: "特性タグ" } as Record<string, string>,
    five: "★5確定タグの組み合わせ", fiveP: "エリート・上級エリートなしで★5以上が確定する最小の組み合わせです。",
    four: "★4以上確定タグの組み合わせ", fourP: "求人タグに次の組み合わせが出たら見逃さないでください。タグを足しても確定は変わりません。",
    star: (lo: number, hi: number) => (lo === hi ? `★${lo}確定` : `★${lo}以上確定`),
  },
};

export default function RecruitSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = T[lang];
  const tag = (ko: string) => tagName(lang, TAG_ID.get(ko), ko);
  const line = (r: ComboResult) => `${r.combo.map(tag).join(" + ")} → ${L.star(r.floor, r.ceil)} (${r.ops.map((o) => opName(lang, o.id, o.name)).join(", ")})`;
  const five = SNIPE_DICT.filter((r) => r.floor >= 5);
  const four = SNIPE_DICT.filter((r) => r.floor === 4);
  return (
    <section className="page-seo" aria-label={L.aria}>
      <details>
        <summary>{SEO_LABEL[lang]}</summary>
        <p className="page-seo-title">{L.summary}</p>
        <h2>{L.how}</h2>
        <p>{L.p1}</p>
        <p>{L.p2}</p>
        <p>{L.p3}</p>

        <h2>{L.tags}</h2>
        <ul className="page-seo-tags">
          {TAG_GROUPS.map(([g, tags]) => <li key={g}><b>{L.groups[g] ?? g}</b> {tags.map(tag).join(" · ")}</li>)}
        </ul>

        <h2>{L.five}</h2>
        <p>{L.fiveP}</p>
        <ul>{five.map((r) => <li key={r.combo.join("+")}>{line(r)}</li>)}</ul>

        <h2>{L.four}</h2>
        <p>{L.fourP}</p>
        <ul>{four.map((r) => <li key={r.combo.join("+")}>{line(r)}</li>)}</ul>
      </details>
    </section>
  );
}
