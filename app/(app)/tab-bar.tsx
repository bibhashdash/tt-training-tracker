"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/today", label: "Today" },
  { href: "/log", label: "Log" },
  { href: "/week", label: "Week" },
  { href: "/settings", label: "Settings" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 items-center justify-center text-sm font-medium ${
                  active ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
