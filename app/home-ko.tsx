"use client";

import Home, { type Operator } from "./home";
import operators from "./data/operators.json";

export default function HomeKo() {
  return <Home locale="ko" operators={operators as unknown as Operator[]} extra={null} />;
}
