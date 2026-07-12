// Compare app/data/operators.json against the latest KR client datamine
// (ArknightsAssets/ArknightsGamedata) and list operators we don't have yet.
//
// Usage: node scripts/check-new-operators.mjs

import { readFile } from "node:fs/promises";

const CHARACTER_TABLE_URL =
  "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel/character_table.json";

const JOB_KO = {
  PIONEER: "뱅가드",
  WARRIOR: "가드",
  TANK: "디펜더",
  SNIPER: "스나이퍼",
  CASTER: "캐스터",
  MEDIC: "메딕",
  SUPPORT: "서포터",
  SPECIAL: "스페셜리스트",
};

const tierToStars = (rarity) =>
  typeof rarity === "number" ? rarity + 1 : Number(String(rarity).replace("TIER_", ""));

const local = JSON.parse(await readFile(new URL("../app/data/operators.json", import.meta.url), "utf-8"));
const localIds = new Set(local.map((operator) => operator.id));

const response = await fetch(CHARACTER_TABLE_URL);
if (!response.ok) throw new Error(`character_table fetch failed: ${response.status}`);
const table = await response.json();
const chars = table.chars ?? table;

const fresh = Object.entries(chars)
  .filter(([id]) => id.startsWith("char_") && !localIds.has(id))
  .map(([id, char]) => ({
    id,
    name: char.name,
    rarity: tierToStars(char.rarity),
    job: JOB_KO[char.profession] ?? char.profession,
    subProfession: char.subProfessionId,
    obtainable: !char.isNotObtainable,
  }))
  .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, "ko"));

console.log(`local: ${localIds.size} | remote: ${Object.keys(chars).filter((id) => id.startsWith("char_")).length} | new: ${fresh.length}\n`);
for (const op of fresh) {
  console.log(`${"★".repeat(op.rarity).padEnd(6, "　")} ${op.name} (${op.id}) — ${op.job}/${op.subProfession}${op.obtainable ? "" : " [획득 불가]"}`);
}
