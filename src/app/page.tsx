"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  classify,
  KIND_LABEL,
  KIND_RATIONALE,
  SEVERITY_OF,
  type FailureKind,
  type RunResult,
  type Severity,
} from "@/lib/classify";
import { parseSchema, SchemaError, type Schema } from "@/lib/schema";
import { failureRate, formatCount, formatRate, runsToRuleOut } from "@/lib/stats";
import { DEMO_PROMPT, DEMO_RESPONSES, DEMO_SCHEMA } from "@/lib/demo";
import { MODELS, runBatch, type ModelId } from "@/lib/anthropic";

const SEV_COLOR: Record<Severity, string> = {
  silent: "var(--sev-silent)",
  crash: "var(--sev-crash)",
  recovered: "var(--sev-recovered)",
};

const SEV_LABEL: Record<Severity, string> = {
  silent: "Silent",
  crash: "Crash",
  recovered: "Recoverable",
};

const SEV_BLURB: Record<Severity, string> = {
  silent: "Parsed fine. Your code accepted it. The value is wrong and nothing was logged.",
  crash: "Threw on parse. Loud, and already visible in your error rate.",
  recovered: "The payload was right but wrapped. Free if you strip it, fatal if you don't.",
};

export default function Home() {
  const [schemaText, setSchemaText] = useState(DEMO_SCHEMA);
  const [prompt, setPrompt] = useState(DEMO_PROMPT);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<ModelId>("claude-sonnet-5");
  const [runs, setRuns] = useState(50);
  const [temperature, setTemperature] = useState(1);
  const [callsPerDay, setCallsPerDay] = useState(1000);

  const [results, setResults] = useState<RunResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [isDemo, setIsDemo] = useState(false);
  const [expanded, setExpanded] = useState<FailureKind | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const schema = useMemo<{ ok: Schema } | { err: string }>(() => {
    try {
      return { ok: parseSchema(schemaText) };
    } catch (e) {
      return { err: e instanceof SchemaError ? e.message : "Invalid schema." };
    }
  }, [schemaText]);

  const loadDemo = useCallback(() => {
    const parsed = parseSchema(DEMO_SCHEMA);
    setSchemaText(DEMO_SCHEMA);
    setPrompt(DEMO_PROMPT);
    setResults(DEMO_RESPONSES.map((r) => classify(r, parsed)));
    setErrors([]);
    setDone(DEMO_RESPONSES.length);
    setIsDemo(true);
  }, []);

  const start = useCallback(async () => {
    if (!("ok" in schema) || !apiKey.trim()) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setIsDemo(false);
    setResults([]);
    setErrors([]);
    setDone(0);

    await runBatch({
      apiKey: apiKey.trim(),
      model,
      prompt,
      schema: schema.ok,
      temperature,
      runs,
      concurrency: 4,
      signal: ctrl.signal,
      onResult: (r) => {
        setDone((d) => d + 1);
        if (r instanceof Error) setErrors((e) => [...e, r.message]);
        else setResults((rs) => [...rs, classify(r, schema.ok)]);
      },
    });

    setRunning(false);
    abortRef.current = null;
  }, [schema, apiKey, model, prompt, temperature, runs]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  // ── Aggregation ──────────────────────────────────────────────────────
  const n = results.length;
  const clean = results.filter((r) => r.clean).length;

  const bySeverity = useMemo(() => {
    const m: Record<Severity, number> = { silent: 0, crash: 0, recovered: 0 };
    for (const r of results) if (r.worst) m[r.worst] += 1;
    return m;
  }, [results]);

  const byKind = useMemo(() => {
    const m = new Map<FailureKind, { count: number; examples: RunResult[] }>();
    for (const r of results) {
      // A response that breaks the same way twice counts once for the rate —
      // the unit is "responses affected", not "findings emitted".
      for (const k of new Set(r.findings.map((f) => f.kind))) {
        const e = m.get(k) ?? { count: 0, examples: [] };
        e.count += 1;
        if (e.examples.length < 3) e.examples.push(r);
        m.set(k, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [results]);

  const silentRate = failureRate(bySeverity.silent, n);
  const anyRate = failureRate(n - clean, n);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">guard-lab</h1>
          <p className="text-[var(--fg-muted)]">One run proves nothing.</p>
        </div>
        <p className="mt-3 max-w-2xl leading-relaxed text-[var(--fg-muted)]">
          Define a schema, run a prompt against it <span className="text-[var(--fg)]">N times</span>
          , and see the distribution of ways it breaks. The failures that matter are the ones that{" "}
          <span className="text-[var(--fg)]">parse cleanly and are wrong</span> — those never reach
          your error rate. Browser-only, BYOK, nothing stored.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ── Left: the contract ─────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-5">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                Schema
              </h2>
              <button
                onClick={loadDemo}
                className="text-xs text-[var(--accent)] underline underline-offset-2 hover:text-[var(--fg)]"
              >
                load a sample run
              </button>
            </div>
            <textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              spellCheck={false}
              rows={9}
              className="w-full min-w-0 resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev-2)] p-3 font-mono text-xs leading-relaxed outline-none focus:border-[var(--accent-dim)]"
            />
            {"err" in schema ? (
              <p className="mt-2 text-xs text-[var(--poor)]">{schema.err}</p>
            ) : (
              <p className="mt-2 text-xs text-[var(--fg-faint)]">
                {Object.keys(schema.ok).length} fields · enum, number, string, boolean, array
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
              Prompt
            </h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              className="w-full min-w-0 resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev-2)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--accent-dim)]"
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--fg-faint)]">
              The schema is appended as a plain instruction — no &ldquo;YOU MUST RETURN ONLY
              JSON&rdquo; hardening. Suppressing the failures here would hand you a compliance
              number your real prompt can&apos;t reproduce.
            </p>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
              Run
            </h2>
            <div className="flex flex-col gap-3">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs text-[var(--fg-faint)]">API key — stays in this tab</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  className="w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev-2)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent-dim)]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs text-[var(--fg-faint)]">Model</span>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value as ModelId)}
                    className="w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev-2)] px-3 py-2 text-sm"
                  >
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs text-[var(--fg-faint)]">Runs</span>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={runs}
                    onChange={(e) => setRuns(Math.max(5, Math.min(200, +e.target.value || 5)))}
                    className="tnum w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev-2)] px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="tnum text-xs text-[var(--fg-faint)]">
                  Temperature {temperature.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(+e.target.value)}
                  className="accent-[var(--accent)]"
                />
              </label>

              {running ? (
                <button
                  onClick={stop}
                  className="tnum rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm hover:border-[var(--poor)]"
                >
                  Stop — {done}/{runs}
                </button>
              ) : (
                <button
                  onClick={start}
                  disabled={!("ok" in schema) || !apiKey.trim()}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#0b0b0f] transition-colors disabled:cursor-not-allowed disabled:bg-[var(--border-strong)] disabled:text-[var(--fg-faint)]"
                >
                  Run {runs} times
                </button>
              )}
              {errors.length > 0 && (
                <p className="text-xs text-[var(--poor)]">
                  {errors.length} request{errors.length > 1 ? "s" : ""} failed — {errors[0]}
                </p>
              )}
            </div>
          </section>
        </div>

        {/* ── Right: what came back ──────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-5">
          {n === 0 ? (
            <section className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-elev)] p-10 text-center">
              <p className="text-[var(--fg-muted)]">
                Nothing run yet. Add a key and press run, or{" "}
                <button
                  onClick={loadDemo}
                  className="text-[var(--accent)] underline underline-offset-2"
                >
                  load a sample run
                </button>
                .
              </p>
            </section>
          ) : (
            <>
              <Verdict
                n={n}
                clean={clean}
                silent={bySeverity.silent}
                crash={bySeverity.crash}
                recovered={bySeverity.recovered}
                silentRate={silentRate}
                anyRate={anyRate}
                callsPerDay={callsPerDay}
                setCallsPerDay={setCallsPerDay}
                isDemo={isDemo}
                partial={running}
              />

              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                  How it broke
                </h2>
                <p className="mb-3 mt-1 text-xs text-[var(--fg-faint)]">
                  Responses affected, not findings emitted — one response can break in more than one
                  way. Click a row for the reasoning and the raw output.
                </p>
                {byKind.length === 0 ? (
                  <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
                    Every response matched the schema exactly. Read the bound above before
                    concluding the rate is zero.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {byKind.map(([kind, { count, examples }]) => (
                      <li key={kind}>
                        <button
                          onClick={() => setExpanded(expanded === kind ? null : kind)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-elev-2)]"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: SEV_COLOR[SEVERITY_OF[kind]] }}
                          />
                          <span className="min-w-0 flex-1 text-sm">{KIND_LABEL[kind]}</span>
                          <span className="tnum shrink-0 text-xs text-[var(--fg-muted)]">
                            {count}/{n}
                          </span>
                          <span className="tnum w-14 shrink-0 text-right text-xs text-[var(--fg-faint)]">
                            {formatRate(count / n)}
                          </span>
                        </button>
                        {expanded === kind && (
                          <div className="mb-2 ml-5 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] p-3">
                            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
                              {KIND_RATIONALE[kind]}
                            </p>
                            {examples.map((ex, i) => (
                              <pre
                                key={i}
                                className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--fg-muted)]"
                              >
                                {ex.raw.length > 400 ? ex.raw.slice(0, 400) + "…" : ex.raw}
                              </pre>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Method />
            </>
          )}
        </div>
      </div>

      <footer className="mt-12 border-t border-[var(--border)] pt-6 text-xs text-[var(--fg-faint)]">
        Built by{" "}
        <a href="https://ferhatatagun.com" className="text-[var(--accent)] hover:underline">
          Ferhat Atagün
        </a>{" "}
        ·{" "}
        <a href="https://ferhatatagun.com/tools" className="text-[var(--accent)] hover:underline">
          more tools
        </a>{" "}
        ·{" "}
        <a
          href="https://github.com/ferhatatagun/guard-lab"
          className="text-[var(--accent)] hover:underline"
        >
          source
        </a>
      </footer>
    </main>
  );
}

function Verdict(props: {
  n: number;
  clean: number;
  silent: number;
  crash: number;
  recovered: number;
  silentRate: ReturnType<typeof failureRate>;
  anyRate: ReturnType<typeof failureRate>;
  callsPerDay: number;
  setCallsPerDay: (n: number) => void;
  isDemo: boolean;
  partial: boolean;
}) {
  const { n, clean, silent, crash, recovered, silentRate, anyRate, callsPerDay, setCallsPerDay } =
    props;

  const segs: Array<[string, number, string]> = [
    ["clean", clean, "var(--sev-clean)"],
    ["recovered", recovered, SEV_COLOR.recovered],
    ["crash", crash, SEV_COLOR.crash],
    ["silent", silent, SEV_COLOR.silent],
  ];

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
          {props.partial ? "Running" : "If you shipped this"}
        </h2>
        <span className="tnum text-xs text-[var(--fg-faint)]">
          {n} run{n === 1 ? "" : "s"}
          {props.isDemo && " · sample data"}
        </span>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--bg-elev-2)]">
        {segs.map(([k, v, c]) =>
          v === 0 ? null : (
            <div key={k} style={{ width: `${(v / n) * 100}%`, background: c }} title={`${k}: ${v}`} />
          )
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Clean" value={clean} n={n} color="var(--sev-clean)" />
        <Stat label="Recoverable" value={recovered} n={n} color={SEV_COLOR.recovered} />
        <Stat label="Crash" value={crash} n={n} color={SEV_COLOR.crash} />
        <Stat label="Silent" value={silent} n={n} color={SEV_COLOR.silent} />
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] p-3">
        {silent > 0 ? (
          <p className="text-sm leading-relaxed">
            <span className="font-medium" style={{ color: SEV_COLOR.silent }}>
              {formatRate(silentRate.observed)} of responses parsed cleanly and were wrong.
            </span>{" "}
            <span className="text-[var(--fg-muted)]">
              At {callsPerDay.toLocaleString("en-US")} calls a day that is{" "}
              <span className="tnum text-[var(--fg)]">
                {formatCount(silentRate.observed * callsPerDay)}
              </span>{" "}
              bad records daily. On {n} runs the true rate sits between {formatRate(silentRate.lo)}{" "}
              and {formatRate(silentRate.hi)}, so plan for up to{" "}
              <span className="tnum text-[var(--fg)]">
                {formatCount(silentRate.hi * callsPerDay)}
              </span>
              .
            </span>
          </p>
        ) : anyRate.zeroObserved ? (
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            <span className="font-medium text-[var(--fg)]">
              Zero failures in {n} runs is not a zero failure rate.
            </span>{" "}
            At this sample size the true rate could still be{" "}
            <span className="tnum text-[var(--fg)]">{formatRate(anyRate.hi)}</span> — about{" "}
            <span className="tnum text-[var(--fg)]">{formatCount(anyRate.hi * callsPerDay)}</span>{" "}
            bad records a day at {callsPerDay.toLocaleString("en-US")} calls. Ruling out 1% takes
            about {runsToRuleOut(0.01)} clean runs.
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            <span className="font-medium text-[var(--fg)]">No silent failures.</span> Everything
            that went wrong either threw or was recoverable by stripping a wrapper — both visible
            from outside. That is the good version of a bad result.
          </p>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs text-[var(--fg-faint)]">
          calls per day
          <input
            type="number"
            min={1}
            value={callsPerDay}
            onChange={(e) => setCallsPerDay(Math.max(1, +e.target.value || 1))}
            className="tnum w-28 rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg)]"
          />
        </label>
      </div>
    </section>
  );
}

function Stat({ label, value, n, color }: { label: string; value: number; n: number; color: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)] px-3 py-2">
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-lg font-semibold" style={{ color }}>
          {value}
        </span>
        <span className="tnum text-xs text-[var(--fg-faint)]">{formatRate(n ? value / n : 0)}</span>
      </div>
      <div className="text-[11px] text-[var(--fg-muted)]">{label}</div>
    </div>
  );
}

function Method() {
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
        How this is judged
      </summary>
      <div className="mt-4 flex flex-col gap-4 text-sm leading-relaxed text-[var(--fg-muted)]">
        {(["silent", "crash", "recovered"] as Severity[]).map((s) => (
          <div key={s}>
            <span className="font-medium" style={{ color: SEV_COLOR[s] }}>
              {SEV_LABEL[s]}
            </span>
            <p className="mt-0.5">{SEV_BLURB[s]}</p>
          </div>
        ))}
        <div>
          <span className="font-medium text-[var(--fg)]">Recovery mirrors production</span>
          <p className="mt-0.5">
            A response is parsed the way defensive code parses it: straight{" "}
            <code className="font-mono text-xs">JSON.parse</code> first, then a fenced block, then
            the widest brace span. Anything still unparseable is a real crash rather than this tool
            being stricter than your code. Valid JSON of the wrong shape — an array of results — is
            never salvaged into its first element, because that would report a recovery while
            discarding data.
          </p>
        </div>
        <div>
          <span className="font-medium text-[var(--fg)]">The interval is Wilson, not normal</span>
          <p className="mt-0.5">
            At zero observed failures the normal approximation gives a zero-width interval, which is
            precisely the false comfort this tool exists to remove. Wilson stays honest at the edges.
            The &ldquo;runs to rule out&rdquo; figure inverts that same interval rather than using
            the usual rule-of-three shortcut — 3/n would promise that 300 clean runs rule out 1%,
            and then this tool would turn around and report 1.26%. Same interval both directions, so
            the two numbers agree.
          </p>
        </div>
        <div>
          <span className="font-medium text-[var(--fg)]">What this does not tell you</span>
          <p className="mt-0.5">
            Anything about whether the answers are <em>good</em>. A response can satisfy every field
            in the schema and still be wrong about the claim. This measures contract compliance,
            which is the floor and not the ceiling.
          </p>
        </div>
      </div>
    </details>
  );
}
