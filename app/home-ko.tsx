"use client";

import Home, { type Operator, type Tab } from "./home";
import operators from "./data/operators.json";
import summaries from "./data/story-summaries.json";
import type { StorySummaries } from "./story";

export default function HomeKo({ initialTab }: { initialTab?: Tab }) {
  return <Home locale="ko" operators={operators as unknown as Operator[]} extra={null} summaries={summaries as unknown as StorySummaries} initialTab={initialTab} />;
}
