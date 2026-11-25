import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fitKey, postingPassages, resumePassages, scoreFit } from "./patches/pilot-fit.mjs";
import { prepareFit, savedFit } from "./patches/pilot-fit-store.mjs";

const posting = ["Requirements", "Develop in Python.", "Experience with one of Cloud A or Cloud B.",
  "Strong presentation skills.", "Nice-to-have skills", "Experience with Tool X or Tool Y.", "Travel twice a year."];
const resume = ["Developed Python services on Cloud B.", "Facilitated technical workshops."];
const item = (label, group, source, status, evidence) => ({ label, group, source, status, evidence, detail: label });
const valid = { ignored: [1, 5], items: [
  item("Python", "required", [2], "covered", [1]), item("One cloud", "required", [3], "covered", [1]),
  item("Presentations", "required", [4], "partial", [2]), item("Optional tool", "preferred", [6], "unshown", []),
  item("Travel", "condition", [7], "unshown", []),
] };

test("quotes come from the supplied PDF and posting; only fully supported candidate requirements count", () => {
  const score = scoreFit(valid, posting, resume);
  assert.equal(score.coveragePct, 67);
  assert.deepEqual(score.counts.required, { total: 3, covered: 2, partial: 1, unshown: 0 });
  assert.deepEqual(score.items[1].source, [posting[2]]);
  assert.deepEqual(score.items[1].evidence, [resume[0]]);
  assert.deepEqual(score.items[3].evidence, []);
  const duty = { ...valid, items: valid.items.map((i) => ({ ...i, group: "duty" })) };
  assert.equal(scoreFit(duty, ["Role overview", ...posting.slice(1)], resume).coveragePct, null);
});

test("a compound printed requirement gets one vote and retains the evidence for each distinct part", () => {
  const p = ["Qualifications", "Technical writing and conference presentation skills.", "Travel each quarter."];
  const raw = { ignored: [1], items: [item("Writing", "required", [2], "covered", [1]),
    item("Presentations", "required", [2], "unshown", []), item("Quarterly travel", "condition", [3], "unshown", [])] };
  const r = scoreFit(raw, p, ["Wrote API manuals."]);
  assert.deepEqual(r.counts.required, { total: 1, covered: 0, partial: 1, unshown: 0 });
  assert.equal(r.items[0].parts.length, 2);
  assert.equal(r.items[0].label, p[1]);
  assert.equal(r.counts.condition.total, 1);
});

test("fail closed on an omitted requirement, an out-of-document citation or unsupported credit", () => {
  const onlyPython = { items: valid.items.slice(0, 1), ignored: [1, 5] };
  assert.throws(() => scoreFit(onlyPython, posting, resume), /Unaccounted/);
  assert.throws(() => scoreFit({ ...onlyPython, ignored: [1, 3, 4, 5, 6, 7] }, posting, resume), /Explicit job criteria/);
  for (const [field, value] of [["source", [103]], ["evidence", [99]], ["evidence", []], ["status", "unshown"]]) {
    const invalid = structuredClone(valid);
    invalid.items[0][field] = value;
    assert.throws(() => scoreFit(invalid, posting, resume));
  }
});

test("a broad introductory expectation does not become a named nice-to-have", () => {
  const p = ["We value continuous improvement.", "Requirements", "Develop in Python.", "Preferred qualifications", "Experience with Tool X."];
  const raw = { ignored: [2, 4], items: [item("Continuous improvement", "preferred", [1], "partial", [1]),
    item("Python", "required", [3], "covered", [1]), item("Tool X", "preferred", [5], "unshown", [])] };
  const score = scoreFit(raw, p, resume);
  assert.equal(score.counts.preferred.total, 1);
  assert.equal(score.items.find((r) => r.label === "Continuous improvement").group, "duty");
});

test("reads pasted prose and custom technologies; preserves PDF evidence across line wraps", () => {
  const long = "We build internal services. ".repeat(20) + "Requirements Proven experience with Tool-Z Proficiency in ExampleQL";
  assert.ok(postingPassages(long).includes("Proficiency in ExampleQL"));
  assert.deepEqual(postingPassages("Requirements\nSource: https://example.invalid/role\nTool-Z"), ["Requirements", "Tool-Z"]);
  assert.deepEqual(resumePassages("Built a reporting service\n   used by operations.\n\nperson@example.invalid\nPython"),
    ["Built a reporting service used by operations.", "Python"]);
  assert.deepEqual(resumePassages("Prague, Czechia | person@example.invalid | linkedin.com/in/example"), ["Prague, Czechia"]);
});

// A real one-line text PDF. Poppler reads the same bytes as the cache key.
function textPdf(line) {
  const content = `BT /F1 12 Tf 20 80 Td (${line}) Tj ET\n`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}endstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, obj] of objects.entries()) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; }
  const start = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return Buffer.from(pdf + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

test("result follows the actual PDF bytes and JD; master, cover and stale/concurrent checks cannot supply the score", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fit-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pdf = path.join(root, "tailored.pdf"), jd = "Required experience with ExampleQL.";
  await fs.writeFile(pdf, textPdf("Built ExampleQL services."));
  await fs.writeFile(path.join(root, "cover.pdf"), textPdf("Never an evidence source."));
  const inputs = await prepareFit(jd, pdf);
  let calls = 0;
  const classify = async (_posting, cv) => {
    calls++;
    const seen = cv[0].includes("ExampleQL");
    return { ignored: [], items: [item("ExampleQL", "required", [1], seen ? "covered" : "unshown", seen ? [1] : [])] };
  };
  assert.equal(await savedFit(inputs, false, root, classify), null);
  const results = await Promise.all([1, 2].map(() => savedFit(inputs, true, root, classify)));
  assert.equal(calls, 1); assert.equal(results[0].coveragePct, 100); assert.deepEqual(results[0], results[1]);
  await fs.writeFile(path.join(root, "cv.md"), "Expert in every skill.");
  assert.deepEqual(await savedFit(await prepareFit(jd, pdf), false, root, classify), results[0]);
  await fs.writeFile(pdf, textPdf("Built batch services."));
  const changed = await prepareFit(jd, pdf);
  assert.notEqual(changed.key, inputs.key); assert.equal(await savedFit(changed, false, root, classify), null);
  assert.equal((await savedFit(changed, true, root, classify)).coveragePct, 0);
  assert.notEqual(fitKey("Another posting", await fs.readFile(pdf), changed.posting, changed.resume), changed.key);
  await assert.rejects(prepareFit("", pdf), /no-archive/);
  await fs.writeFile(pdf, "not a pdf");
  await assert.rejects(prepareFit(jd, pdf), /unreadable-pdf/);
});

test("explicit preferences override required labels and stop at the next qualification heading", () => {
  const jd = ["Requirements", "Python and Django are required", "Payments and KYC integrations are strong plus",
    "BONUS: YOU’VE DONE ONE OF THESE BEFORE", "Built ML services", "Built agent runtimes",
    "WHO YOU ARE NOT", "Junior engineers are outside the seniority range", "English B2+",
    "Benefits", "Annual performance bonus"];
  const raw = { ignored: [1, 4, 7, 10, 11], items: [2, 3, 5, 6, 8, 9].map((id) =>
    item(jd[id-1], "required", [id], id === 2 ? "covered" : "unshown", id === 2 ? [1] : [])) };
  const score = scoreFit(raw, jd, resume);
  assert.deepEqual(score.items.filter(r => r.group === "preferred").map(r => r.source[0]), [jd[2], jd[4], jd[5]]);
  assert.equal(score.coveragePct, 33);
  assert.equal(score.counts.required.total, 3);
});

test("a preferred implementation does not penalize the supported mandatory capability", () => {
  const jd = ["Requirements", "Experience with SQL databases (preferably PostgreSQL)"];
  const raw = { ignored: [1], items: [item("SQL databases", "required", [2], "covered", [1]),
    item("PostgreSQL", "preferred", [2], "unshown", [])] };
  const score = scoreFit(raw, jd, resume);
  assert.equal(score.coveragePct, 100);
  assert.equal(score.counts.preferred.unshown, 1);
});

test("recognizes a preference split by HTML formatting and Czech optional headings", () => {
  for (const [jd, ids, ignored] of [
    [["Requirements", "Python experience", "If you have experience with", "Go", ", that's a big advantage."], [3,4,5], [1]],
    [["Requirements", "Python experience", "Výhodou", "Go"], [4], [1,3]],
  ]) {
    const raw = {ignored, items: [item("Python", "required", [2], "covered", [1]), item("Go", "required", ids, "unshown", [])]};
    const result = scoreFit(raw, jd, resume);
    assert.equal(result.counts.preferred.unshown, 1);
    assert.equal(result.coveragePct, 100);
  }
});

test("a bonus on a single line does not change the following mandatory qualification", () => {
  const jd = ["Requirements", "Bonus: experience with Go", "Python expertise"];
  const items = [item("Go", "required", [2], "unshown", []), item("Python", "required", [3], "covered", [1])];
  const result = scoreFit({ignored: [1], items}, jd, resume);
  assert.equal(result.counts.preferred.unshown, 1);
  assert.equal(result.coveragePct, 100);
});
