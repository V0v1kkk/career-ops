"use client";

import { useState } from "react";
import { useJobs } from "@/components/jobs/job-store";
import { EvaluationOptions, useEvaluationOptions } from "@/components/evaluation-options";
import { FULL_EVALUATION } from "@/lib/evaluation-options.mjs";
import { pilotRunError } from "@/lib/pilot-policy.mjs";

export function QuickEvaluate() {
  const { startJob } = useJobs();
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const { sections, setSections } = useEvaluationOptions();
  function run() {
    const input = text.trim();
    const error = pilotRunError("evaluate", input);
    if (error) { setHint(error); return; }
    startJob({ title: "Evaluate · pasted job description", subtitle: "Offline evaluation of supplied text", kind: "evaluate", input, page: "/", evaluationSections: sections });
    setHint("Evaluation started. Follow its progress in the Workers tray.");
  }
  return (
    <section id="pilot-evaluate" className="mt-7 max-w-2xl scroll-mt-6 rounded-xl border border-border bg-surface/70 p-4">
      <a href="/vacancies/index.html" className="mb-3 inline-block text-sm text-brand-text underline">Python vacancies · remote from Czechia and Prague</a>
      <label htmlFor="pilot-job-text" className="block text-sm font-semibold">Evaluate a pasted job description</label>
      <p className="mt-1 text-xs text-muted">Open a vacancy yourself, then paste its complete text with the company, role and requirements. This pilot does not fetch job links or verify whether a posting is still open.</p>
      <textarea id="pilot-job-text" value={text} rows={7} maxLength={60000}
        onChange={(event) => { setText(event.target.value); if (hint) setHint(""); }}
        placeholder="Paste the full job description here, not just its URL…"
        className="mt-3 block w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-brand/50" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={run} disabled={!text.trim()}
          className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:cursor-not-allowed disabled:opacity-50">Evaluate pasted text</button>
        <span className="text-xs text-muted">Uses the configured AI provider. The original job text is archived with the report.</span>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-brand-text">Evaluation options · {sections.length === FULL_EVALUATION.length ? "full evaluation" : `${sections.length} optional sections`}</summary>
        <div className="mt-3"><EvaluationOptions sections={sections} onChange={setSections} /></div>
      </details>
      {hint && <p role="status" className="mt-2 text-xs text-muted">{hint}</p>}
    </section>
  );
}
