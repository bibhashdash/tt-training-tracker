"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = { step: "email", email: "" };

const input =
  "h-12 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900";
const primary =
  "h-12 rounded-lg bg-zinc-900 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  if (state.step === "email") {
    return (
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="send" />
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          className={input}
        />
        {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Sent to <span className="font-medium text-zinc-900 dark:text-zinc-100">{state.email}</span>. Tap the link in
        the email, or type the code here.
      </p>
      <label htmlFor="code" className="text-sm font-medium">
        Code
      </label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        className={`${input} text-center text-xl tracking-[0.4em]`}
      />
      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button type="submit" name="intent" value="verify" disabled={pending} className={primary}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      <button
        type="submit"
        name="intent"
        value="restart"
        formNoValidate
        className="h-10 text-sm text-zinc-600 underline dark:text-zinc-400"
      >
        Use a different email
      </button>
    </form>
  );
}
