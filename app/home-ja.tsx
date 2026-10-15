"use client";

import type { ReactNode } from "react";
import Home, { type Operator, type Tab } from "./home";
import type { Enemy, EnemyStages } from "./enemy-detail";
import type { StageView } from "./stage-data";
import operators from "./data/operators.ja.json";
import extra from "./data/extra-i18n.ja.json";
import type { ExtraI18n } from "./i18n";

export default function HomeJa({ initialTab, initialStory, initialOperator, initialRogue, initialSandbox, initialAutochess, initialEnemy, pageEnemy, pageEnemyStages, pageStage, pageSeo }: { initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialSandbox?: string; initialAutochess?: string; initialEnemy?: string; pageEnemy?: Enemy | null; pageEnemyStages?: EnemyStages | null; pageStage?: StageView | null; pageSeo?: ReactNode }) {
  return <Home locale="ja" operators={operators as unknown as Operator[]} extra={extra as unknown as ExtraI18n} summariesLoader={() => import("./data/story-summaries.ja.json")} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} initialSandbox={initialSandbox} initialAutochess={initialAutochess} initialEnemy={initialEnemy} pageEnemy={pageEnemy} pageEnemyStages={pageEnemyStages} pageStage={pageStage} pageSeo={pageSeo} />;
}
