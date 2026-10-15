"use client";

import Home, { type Operator, type Tab } from "./home";
import type { Enemy, EnemyStages } from "./enemy-detail";
import type { StageView } from "./stage-data";
import operators from "./data/operators.json";
import type { ReactNode } from "react";

export default function HomeKo({ initialTab, initialStory, initialOperator, initialRogue, initialSandbox, initialAutochess, initialEnemy, pageEnemy, pageEnemyStages, pageStage, pageSeo }: { initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialSandbox?: string; initialAutochess?: string; initialEnemy?: string; pageEnemy?: Enemy | null; pageEnemyStages?: EnemyStages | null; pageStage?: StageView | null; pageSeo?: ReactNode }) {
  return <Home locale="ko" operators={operators as unknown as Operator[]} extra={null} summariesLoader={() => import("./data/story-summaries.json")} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} initialSandbox={initialSandbox} initialAutochess={initialAutochess} initialEnemy={initialEnemy} pageEnemy={pageEnemy} pageEnemyStages={pageEnemyStages} pageStage={pageStage} pageSeo={pageSeo} />;
}
