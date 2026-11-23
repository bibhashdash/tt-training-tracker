import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Selby TT Tracker</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Sign in with your email.</p>
      </div>
      <Suspense fallback={null}>
        <LinkError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </main>
  );
}

async function LinkError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  if (!error) return null;
  return (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      That sign-in link has expired or was already used. Send a new one.
    </p>
  );
}
