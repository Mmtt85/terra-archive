"use client";

import Home, { type Operator, type Tab } from "./home";
import operators from "./data/operators.json";

export default function HomeKo({ initialTab }: { initialTab?: Tab }) {
  return <Home locale="ko" operators={operators as unknown as Operator[]} extra={null} initialTab={initialTab} />;
}
