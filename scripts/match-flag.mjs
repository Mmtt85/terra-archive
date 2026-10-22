#!/usr/bin/env node
// 친구 찾기 닉네임·한마디 판정 표(match_flag, 계정 D1) — match-flag 스킬이 쓴다 (2026-10-22).
// 판정 자체는 스킬이 하이쿠에게 맡기고, 이 스크립트는 목록 뽑기·결과 쓰기만 한다.
//   node scripts/match-flag.mjs pending              # 아직 판정 안 한 값 (JSON 배열 [{field, value, server}])
//   node scripts/match-flag.mjs apply <결과.json>     # [{field, value, verdict: "bad"|"ok"|"unsure"}] 를 적는다 (by=haiku)
//   node scripts/match-flag.mjs set <nick|resume> <값> <bad|ok|unsure>   # 사람이 직접 (by=manual)
//   node scripts/match-flag.mjs list                 # 불량·애매로 적힌 것
// 닉네임은 '#번호'를 뗀 이름으로 판정한다(번호만 바꿔 다시 등록해도 같은 이름이면 그대로 가린다).
import fs from "node:fs";
import { d1, sqlq } from "./riic-lib.mjs";

const VERDICT = { bad: 1, ok: 0, unsure: 2 };
const nickName = (nick) => String(nick ?? "").replace(/#\d+$/, "").trim();
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "pending") {
  const rows = d1("select server, nick, resume from match");
  const done = new Set(d1("select field, value from match_flag").map((r) => `${r.field}\u0000${r.value}`));
  const out = new Map();
  for (const r of rows) {
    for (const [field, value] of [["nick", nickName(r.nick)], ["resume", String(r.resume ?? "").trim()]]) {
      if (!value || /^[.\s]+$/.test(value)) continue;   // 빈 값·점만 있는 한마디는 볼 것 없다
      const k = `${field}\u0000${value}`;
      if (!done.has(k) && !out.has(k)) out.set(k, { field, value, server: r.server });
    }
  }
  console.log(JSON.stringify([...out.values()], null, 1));
} else if (cmd === "apply" || cmd === "set") {
  const list = cmd === "apply"
    ? JSON.parse(fs.readFileSync(args[0], "utf8"))
    : [{ field: args[0], value: args[1], verdict: args[2] }];
  const by = cmd === "apply" ? "haiku" : "manual";
  const now = Date.now();
  const stmts = [];
  for (const x of list) {
    if (!["nick", "resume"].includes(x.field) || !(x.verdict in VERDICT) || !x.value) { console.error("건너뜀:", JSON.stringify(x)); continue; }
    const value = x.field === "nick" ? nickName(x.value) : String(x.value).trim();
    stmts.push(`insert into match_flag (field, value, bad, at, by) values (${sqlq(x.field)}, ${sqlq(value)}, ${VERDICT[x.verdict]}, ${now}, ${sqlq(by)})
      on conflict(field, value) do update set bad = excluded.bad, at = excluded.at, by = excluded.by`);
  }
  if (stmts.length) d1(stmts.join(";\n"));
  console.log(`${stmts.length}건 적음 (${list.filter((x) => x.verdict === "bad").length} 불량 · ${list.filter((x) => x.verdict === "unsure").length} 애매)`);
} else if (cmd === "list") {
  const rows = d1("select field, value, bad, at, by from match_flag where bad <> 0 order by bad, at desc");
  for (const r of rows) console.log(`${r.bad === 1 ? "불량" : "애매"} · ${r.field === "nick" ? "닉네임" : "한마디"} · ${r.value} · ${r.by} · ${new Date(r.at).toLocaleString("ko-KR")}`);
  if (!rows.length) console.log("불량·애매로 적힌 것 없음");
} else {
  console.error("사용법: pending | apply <결과.json> | set <nick|resume> <값> <bad|ok|unsure> | list");
  process.exit(2);
}
