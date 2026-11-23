"use client";

import { Bike, CalendarDays, NotebookPen, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; Icon: LucideIcon; also?: string[] }[] = [
  { href: "/today", label: "Today", Icon: Bike },
  { href: "/log", label: "Daily log", Icon: NotebookPen },
  { href: "/week", label: "Week", Icon: CalendarDays, also: ["/review"] },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function TabBar() {
  return <TabBarView pathname={usePathname()} />;
}

/** Icon-only bottom nav. Also used without a pathname as the Suspense fallback. */
export function TabBarView({ pathname }: { pathname: string | null }) {
  const matches = (path: string) => pathname !== null && (pathname === path || pathname.startsWith(`${path}/`));

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ href, label, Icon, also }) => {
          const active = matches(href) || (also ?? []).some(matches);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-label={label}
                title={label}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 ${
                  active ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                <Icon aria-hidden size={24} strokeWidth={active ? 2.25 : 1.75} />
                <span
                  aria-hidden
                  className={`h-1 w-1 rounded-full ${active ? "bg-zinc-900 dark:bg-white" : "bg-transparent"}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
