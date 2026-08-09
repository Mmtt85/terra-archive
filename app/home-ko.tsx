"use client";

import Home, { type Operator, type Tab } from "./home";
import type { Enemy, EnemyStages } from "./enemy-detail";
import type { StageView } from "./stage-data";
import operators from "./data/operators.json";

export default function HomeKo({ initialTab, initialStory, initialOperator, initialRogue, initialEnemy, pageEnemy, pageEnemyStages, pageStage }: { initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialEnemy?: string; pageEnemy?: Enemy | null; pageEnemyStages?: EnemyStages | null; pageStage?: StageView | null }) {
  return <Home locale="ko" operators={operators as unknown as Operator[]} extra={null} summariesLoader={() => import("./data/story-summaries.json")} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} initialEnemy={initialEnemy} pageEnemy={pageEnemy} pageEnemyStages={pageEnemyStages} pageStage={pageStage} />;
}
