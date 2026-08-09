"use client";

import Home, { type Operator, type Tab } from "./home";
import type { Enemy, EnemyStages } from "./enemy-detail";
import type { StageView } from "./stage-data";
import operators from "./data/operators.ja.json";
import extra from "./data/extra-i18n.ja.json";
import type { ExtraI18n } from "./i18n";

export default function HomeJa({ initialTab, initialStory, initialOperator, initialRogue, initialEnemy, pageEnemy, pageEnemyStages, pageStage }: { initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialEnemy?: string; pageEnemy?: Enemy | null; pageEnemyStages?: EnemyStages | null; pageStage?: StageView | null }) {
  return <Home locale="ja" operators={operators as unknown as Operator[]} extra={extra as unknown as ExtraI18n} summariesLoader={() => import("./data/story-summaries.ja.json")} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} initialEnemy={initialEnemy} pageEnemy={pageEnemy} pageEnemyStages={pageEnemyStages} pageStage={pageStage} />;
}
