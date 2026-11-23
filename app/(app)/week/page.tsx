import type { Metadata } from "next";
import { Placeholder } from "../placeholder";

export const metadata: Metadata = { title: "Week" };

export default function WeekPage() {
  return <Placeholder title="Week" milestone={4} />;
}
