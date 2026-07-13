"use client";

import Home, { type Operator } from "./home";
import operators from "./data/operators.ja.json";
import extra from "./data/extra-i18n.ja.json";
import type { ExtraI18n } from "./i18n";

export default function HomeJa() {
  return <Home locale="ja" operators={operators as unknown as Operator[]} extra={extra as unknown as ExtraI18n} />;
}
