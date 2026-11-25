"use client";

import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";

const sections = { required: "Candidate requirements", duty: "Responsibilities and other role expectations", preferred: "Preferred qualifications", condition: "Practical conditions" };
const ratings = { covered: "Supported", partial: "Partly supported", unshown: "Undocumented" };
type Group = keyof typeof sections;
type Rating = keyof typeof ratings;
type Finding = { label: string; status: Rating; evidence: string[]; detail: string };
type Criterion = Finding & { group: Group; source: string[]; parts?: Finding[] };
type Counts = Record<Rating | "total", number>;
type Result = { coveragePct: number | null; hasQualificationList: boolean; counts: Record<Group, Counts>; items: Criterion[] };
type Reply = { result: Result | null; reason?: string; reportNumber?: number };
const messages: Record<string, string> = {
  "no-report": "This evaluation report is unavailable.",
  "no-archive": "Save the full job description with the evaluation to compare it.",
  "no-tailored-cv": "Generate a tailored CV PDF for this report to compare it with the posting.",
  "unreadable-pdf": "The saved PDF has no readable text. Generate a text-based CV PDF for this role.",
  "input-too-large": "The saved posting or PDF exceeds the comparison size limit.",
  "not-compared": "Compare the current posting and saved CV PDF using the configured model through LiteLLM.",
  "invalid-comparison": "The model returned an incomplete comparison. You can run it again.",
  "worker-failed": "The comparison worker could not finish. You can try again.",
  failed: "The comparison could not be loaded.",
};

async function requestFit(id: string, method: "GET" | "POST", signal?: AbortSignal): Promise<Reply> {
  const res = await fetch(`/api/keyword-match?report=${encodeURIComponent(id)}`, { method, cache: "no-store", signal });
  if (!res.ok) throw new Error("Comparison request failed");
  return res.json();
}

export function KeywordCoverage({ reportId }: { reportId: string }) {
  return <Comparison key={reportId} id={reportId} />;
}

function Evidence({ part }: { part: Finding }) {
  return <><p>{part.detail}</p><p className="mt-2 font-medium">Tailored PDF</p>
    {part.evidence.length ? part.evidence.map((quote, i) => <blockquote className="text-muted" key={i}>{quote}</blockquote>) : <p className="text-muted">No supporting passage identified.</p>}
  </>;
}

function Comparison({ id }: { id: string }) {
  const [data, setData] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    requestFit(id, "GET", controller.signal).then(setData).catch(() => {
      if (!controller.signal.aborted) setData({ result: null, reason: "failed" });
    });
    return () => controller.abort();
  }, [id]);

  async function generate() {
    setBusy(true);
    try {
      const answer = await requestFit(id, "POST");
      // The PDF or posting may have changed while the worker was running.
      setData(answer.result ? await requestFit(id, "GET") : answer);
    } catch {
      setData({ result: null, reason: "failed" });
    } finally {
      setBusy(false);
    }
  }

  const result = data?.result;
  return <section id="tailored-cv-fit" aria-label="Tailored CV comparison" className="mt-8 scroll-mt-5 rounded-2xl border border-border bg-surface/40 px-5 py-4">
    <h2 className="flex items-center gap-2 font-display text-base text-landing"><ScanSearch className="size-4 text-brand-text" />Job requirements vs tailored CV</h2>
    {!result ? <div className="mt-2 text-sm text-muted" aria-live="polite">
      <p>{busy ? "Comparing the posting with the saved PDF…" : data ? messages[data.reason ?? "failed"] ?? messages.failed : "Loading comparison…"}</p>
      {data && ["not-compared", "invalid-comparison", "worker-failed", "failed"].includes(data.reason ?? "") &&
        <button type="button" disabled={busy} onClick={generate} className="mt-3 rounded-lg border border-border px-3 py-2 text-foreground disabled:opacity-50">Compare tailored PDF</button>}
    </div> : <>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
        {result.coveragePct !== null && <strong className="text-3xl tabular-nums">{result.coveragePct}%</strong>}
        <span>{result.counts.required.total ? `${result.counts.required.covered} of ${result.counts.required.total} candidate requirements fully supported` : "No separate candidate requirements identified."}</span>
      </p>
      <p className="mt-1 text-sm text-muted">{result.hasQualificationList ? "Each qualification statement in the posting counts once. Full credit requires evidence for all its essential parts." : "The comparison groups candidate criteria from the posting. Fully supported criteria count toward the percentage."} Open a criterion for its evidence.</p>
      <a href={`/api/cv-pdf?n=${data?.reportNumber}&kind=cv`} className="mt-2 inline-block text-sm text-brand-text underline">View the compared PDF</a>
      {(Object.entries(sections) as [Group, string][]).map(([group, title]) => {
        const count = result.counts[group];
        if (!count.total) return null;
        return <details key={group} open={group === "required"} className="mt-4 rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">{title} ({count.total}) <span className="font-normal text-muted">· {count.covered} supported · {count.partial} partial · {count.unshown} undocumented</span></summary>
          <ul className="mt-2 divide-y divide-border">
            {result.items.filter((row) => row.group === group).map((row) => <li key={row.label} className="py-2">
              <details><summary className="cursor-pointer text-sm"><span className="font-medium">{row.label}</span> <span className="text-muted">· {ratings[row.status]}</span></summary>
                <div className="mt-2 pl-3 text-sm">
                  <p className="mt-2 font-medium">Job posting</p>{row.source.map((quote, i) => <blockquote className="text-muted" key={i}>{quote}</blockquote>)}
                  {row.parts?.length ? row.parts.map((part) => <div className="mt-3" key={part.label}>
                    <p className="font-medium">{part.label} · {ratings[part.status]}</p><Evidence part={part} />
                  </div>) : <div className="mt-2"><Evidence part={row} /></div>}
                </div>
              </details>
            </li>)}
          </ul>
        </details>;
      })}
    </>}
  </section>;
}
