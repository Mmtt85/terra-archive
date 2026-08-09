"use client";

import Home, { type Operator, type Tab } from "./home";
import operators from "./data/operators.json";

export default function HomeKo({ initialTab, initialStory, initialOperator, initialRogue }: { initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string }) {
  return <Home locale="ko" operators={operators as unknown as Operator[]} extra={null} summariesLoader={() => import("./data/story-summaries.json")} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} />;
}
