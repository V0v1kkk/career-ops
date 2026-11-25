import fs from "node:fs/promises";
import path from "node:path";
import { careerOpsRoot, findApplication, isRegularContainedFile, pdfPathStatusForReport, readReport } from "@/lib/career-ops";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { JD_HEADING_RE, NEXT_REPORT_SECTION_RE } from "@/lib/pilot-jd-archive.mjs";
import { prepareFit, savedFit } from "@/lib/pilot-fit-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The pilot archives the pasted posting itself. Older core reports may instead
// link a retained plain-text JD under the workspace's jds/ directory.
async function archivedPosting(report: string) {
  const heading = JD_HEADING_RE.exec(report);
  if (!heading) return "";
  const tail = report.slice(heading.index + heading[0].length);
  const next = tail.search(NEXT_REPORT_SECTION_RE);
  const body = (next < 0 ? tail : tail.slice(0, next)).trim();
  if (!/^See jds\//i.test(body)) return body;
  const pointer = /^See (jds\/[A-Za-z0-9][\w.-]*) for the full archive\b/i.exec(body);
  if (!pointer) return "";
  const root = careerOpsRoot();
  const file = path.join(root, pointer[1]);
  return isRegularContainedFile(file, root) && isRegularContainedFile(file, path.join(root, "jds"))
    ? fs.readFile(/* turbopackIgnore: true */ file, "utf8") : "";
}

const reply = (body: object) => Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
const unavailable = (reason: string) => reply({ available: false, reason, result: null });

async function compare(req: Request, generate: boolean) {
  const id = (new URL(req.url).searchParams.get("report") ?? "").trim();
  if (!/^\d+$/.test(id)) return unavailable("no-report");
  try {
    const report = readReport(id);
    if (!report) return unavailable("no-report");
    const n = reportNumberFor(id, findApplication(id), report.file);
    const fileNumber = /^(\d+)[-_.]/.exec(report.file);
    if (n == null || (fileNumber && Number(fileNumber[1]) !== n)) return unavailable("no-tailored-cv");
    const pdf = await pdfPathStatusForReport(String(n), "cv");
    if (pdf.status !== "found") return unavailable("no-tailored-cv");
    const input = await prepareFit(await archivedPosting(report.content), pdf.path);
    const result = await savedFit(input, generate, "/state/cache/tailored-fit");
    return reply({ available: !!result, reason: result ? null : "not-compared", result,
      pdf: path.basename(pdf.path), reportNumber: n });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "";
    return unavailable(["no-archive", "input-too-large", "unreadable-pdf", "invalid-comparison", "worker-failed"].includes(reason) ? reason : "failed");
  }
}

export function GET(req: Request) { return compare(req, false); }
export function POST(req: Request) { return compare(req, true); }
