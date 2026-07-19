import { LockKeyhole, ShieldCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafafa] px-5 py-10 text-zinc-950">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-950 text-white shadow-sm">
            <ShieldCheck aria-hidden="true" size={21} />
          </span>
          <span className="text-lg font-semibold">Warden</span>
        </div>

        <section className="rounded-md border border-zinc-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-700">
            <LockKeyhole aria-hidden="true" size={18} />
          </div>
          <h1 className="mt-5 text-xl font-semibold">Open team dashboard</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">Enter your organization&apos;s dashboard access token.</p>

          <form action="/api/session" className="mt-6" method="post">
            <label className="text-xs font-medium text-zinc-700" htmlFor="token">
              Access token
            </label>
            <input
              aria-describedby={error ? 'login-error' : undefined}
              autoComplete="current-password"
              autoFocus
              className="mt-2 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              id="token"
              maxLength={4096}
              name="token"
              required
              type="password"
            />
            {error ? (
              <p className="mt-2 text-xs text-rose-700" id="login-error" role="alert">
                That access token is not valid.
              </p>
            ) : null}
            <button className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2" type="submit">
              Continue
            </button>
          </form>
        </section>

        <p className="mt-5 text-center text-xs text-zinc-400">Aggregate protection data only</p>
      </div>
    </main>
  );
}
