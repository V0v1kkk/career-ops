// Draft-only style changes to the pinned English cover mode. The web runner
// still stops after Step 8; no PDF, file-write or submission capability changes.
export function patchCoverMode(text) {
  const replace = (before, after) => {
    if (text.split(before).length !== 2) throw new Error("Pinned cover-mode anchor changed");
    text = text.replace(before, after);
  };
  const section = (start, end, replacement, divider = true) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from);
    if (from < 0 || to < 0) throw new Error("Pinned cover-mode section changed");
    replace(text.slice(from, to), replacement + (divider ? "\n\n---\n\n" : "\n\n"));
  };

  replace("- Professional summary (profile introduction source)", "- Professional summary (background context; do not repeat it as a separate biography)");
  replace("- All achievement bullets across all roles (achievement selection pool)", "- Relevant work and outcomes across all roles (evidence selection pool)");
  replace("- Apply to: opening, profile intro, achievements (vocabulary only), problems section", "- Apply to: opening, relevant evidence and proposed approach, only where the wording fits the facts");
  replace("- Use each keyword once — never repeat for density", "- No keyword quota: use only relevant terms naturally, without repetition for density or keyword stuffing");

  section("## Step 7 — Achievement selection (from cv.md only)", "## Step 8 — Draft the letter in chat (mandatory before PDF)", `## Step 7 — Evidence selection (from cv.md only)

Choose 1-2 relevant examples from \`cv.md\` that best explain the connection to this role. \`article-digest.md\` may add context but is not a source of new achievements for this step.

1. Read the work and outcomes across roles and compare them with the JD's main responsibilities.
2. Prefer the clearest relevant examples; an example does not need a metric to be useful.
3. Paraphrase freely into natural sentences. Preserve employers, roles, dates, metric values, units, ownership and causal meaning exactly whenever mentioned. Keep each outcome with its original employer and work; never combine separate achievements into a new claim.
4. Use only supported skills and experience. Do not invent credentials, seniority, duration, motivation or personality, and do not turn a proposed approach into past experience.
5. Connect the examples to the role without copying CV bullets or adding numbers or keywords to meet a quota. The candidate's Step 6 answers supply their motivation and proposed approach; they are not evidence of past achievements.`);

  section("Write the full letter as plain text in the chat. Follow this structure:", 'End the draft with: "How does this read? Once you approve I\'ll generate the PDF."', `Write the full letter as plain text in the chat. Keep the candidate header and write the body in 3-4 short, connected paragraphs, without section headings or achievement bullets. This is a flexible guide, not a sentence-by-sentence template. Do not add a separate profile introduction or credentials recap; include background only when it helps explain the fit.

\`\`\`text
[Candidate Name]
[Location] | [Email] | [Phone if available] | [LinkedIn if available]

Cover Letter: [Role Title]
[Company], [City]   [Date]

[If the source is marked synthetic/test data, retain its visible marker here, outside the letter body.]

[Salutation — optional, only if a named hiring manager is known]

[Opening paragraph]
State the supplied reason for applying in the chosen tone. Avoid a generic career summary or invented enthusiasm.

[One or two evidence paragraphs]
Weave the selected 1-2 examples into natural prose and explain their relevance. Paraphrase the source wording while preserving the facts and their attribution. Use a metric only when it helps the reader understand the example.

[Final paragraph]
Connect the candidate's supplied approach to the role, clearly as a proposed approach rather than a claim about past work or a guaranteed result. Close briefly. Mention availability or a gap only when the candidate chose to include it and preserve any uncertainty; omit unconfirmed availability instead of promising a start date.
\`\`\`

Keep QA or fixture commentary outside the letter body. A visible synthetic marker must remain when present in the source, but phrases such as "fictional professional experience" and "my profile lists" are not candidate prose. Removing that commentary must not remove a real qualification, uncertainty or limitation. An optional language closing still requires the user's Step 5 confirmation.`, false);

  replace('6. **Concrete over abstract** — every claim needs a number, system name, or specific outcome. "Improved performance" is banned. "Cut latency from 2s to 380ms" is fine.', '6. **Concrete when supported** — use relevant work, systems or outcomes from the source. Numbers are optional; never add a number, stronger result or causal claim merely to sound specific.');
  replace("7. **350-420 words** total body (header + credentials not counted)", "7. **Length** — aim for 150-220 words in the body as a soft target, excluding the header and synthetic marker. Follow the candidate's own length preference if supplied. Do not pad a clear letter or force a useful example to fit a word count.");
  replace("8. **Bullet format** — `**Bold lead phrase,** impact sentence with metric.` No em dash between lead and sentence.", "8. **Natural paragraphs** — use short connected prose, with no mandatory bullet block, bold lead phrases, metric quota or keyword quota.");
  replace("9. **Self-check** — before finalising, re-read each sentence: could it appear in any cover letter for any company? If yes, rewrite it.", "9. **Self-check** — remove generic claims, repetition and inflated language. Keep the letter grounded in the supplied motivation, role and evidence; ordinary transitions and a brief closing need no invented detail.");
  replace("when rendering (see Step 7).", "when rendering. This legacy PDF field does not prescribe the chat draft's structure.");
  replace("- Whether the word count hit the 350-420 target (if short or long, note it)", "- Approximate body word count against the candidate's preference or the soft 150-220 word target; do not pad the draft just to meet it");
  return text;
}
