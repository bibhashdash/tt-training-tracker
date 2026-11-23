import type { Metadata } from "next";
import { Placeholder } from "../placeholder";

export const metadata: Metadata = { title: "Daily log" };

export default function LogPage() {
  return <Placeholder title="Daily log" milestone={2} />;
}
