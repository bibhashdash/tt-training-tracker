import { TabBar } from "./tab-bar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-28">{children}</main>
      <TabBar />
    </>
  );
}
