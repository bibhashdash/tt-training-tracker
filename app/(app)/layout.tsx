import { Suspense } from "react";
import { TabBar, TabBarView } from "./tab-bar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+6rem)]">
        {children}
      </main>
      <Suspense fallback={<TabBarView pathname={null} />}>
        <TabBar />
      </Suspense>
    </>
  );
}
