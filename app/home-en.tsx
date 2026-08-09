"use client";

import Home, { type Operator, type Tab } from "./home";
import type { Enemy, EnemyStages } from "./enemy-detail";
import operators from "./data/operators.en.json";
import extra from "./data/extra-i18n.en.json";
import type { ExtraI18n } from "./i18n";

export default function HomeEn({ initialTab, initialStory, initialOperator, initialRogue, initialEnemy, pageEnemy, pageEnemyStages }: { initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialEnemy?: string; pageEnemy?: Enemy | null; pageEnemyStages?: EnemyStages | null }) {
  return <Home locale="en" operators={operators as unknown as Operator[]} extra={extra as unknown as ExtraI18n} summariesLoader={() => import("./data/story-summaries.en.json")} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} initialEnemy={initialEnemy} pageEnemy={pageEnemy} pageEnemyStages={pageEnemyStages} />;
}
