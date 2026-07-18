"use client";

import Home, { type Operator, type Tab } from "./home";
import operators from "./data/operators.ja.json";
import extra from "./data/extra-i18n.ja.json";
import summaries from "./data/story-summaries.ja.json";
import type { StorySummaries } from "./story";
import type { ExtraI18n } from "./i18n";

export default function HomeJa({ initialTab }: { initialTab?: Tab }) {
  return <Home locale="ja" operators={operators as unknown as Operator[]} extra={extra as unknown as ExtraI18n} summaries={summaries as unknown as StorySummaries} initialTab={initialTab} />;
}
