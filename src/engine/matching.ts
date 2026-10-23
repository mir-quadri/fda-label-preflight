/**
 * The preflight matching engine.
 *
 * Given one medication's FDA label and a list of medications someone already
 * takes, find every place the label's interaction / warning sections MENTION
 * one of those medications (by generic name, brand name, or known synonym),
 * and return a verbatim quoted excerpt around each mention.
 *
 * Deliberate limits, stated plainly:
 *  - This is TEXT MENTION detection, not a clinical interaction database.
 *    FDA labels are prose; they omit interactions, bury them in tables, and
 *    vary by manufacturer. No mention found ≠ safe. A mention found ≠ proof
 *    of harm. Every flag means exactly one thing: "the label itself raises
 *    this — discuss it with your pharmacist or doctor before swallowing."
 *  - Class mentions ("ACE inhibitors", "NSAIDs") are real label language but
 *    can't be attributed to a specific medication on the list without a drug
 *    class database, so the engine only matches specific drug names.
 */
import { termsForMedication } from "../fda/names.js";
import type { LabelData, LabelFlag } from "../fda/types.js";

const EXCERPT_CHARS = 300;
const CONTEXT_BEFORE = 110;

/** Sections scanned for mentions, in the order flags are reported. */
const SCANNED_SECTIONS: Array<{ key: "drugInteractions" | "warnings" | "boxedWarning"; label: string }> = [
  { key: "drugInteractions", label: "drug_interactions" },
  { key: "warnings", label: "warnings" },
  { key: "boxedWarning", label: "boxed_warning" },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract a <= EXCERPT_CHARS verbatim quote centred on the match. */
export function excerptAround(text: string, matchIndex: number, matchLength: number): string {
  let start = Math.max(0, matchIndex - CONTEXT_BEFORE);
  let end = Math.min(text.length, matchIndex + matchLength + (EXCERPT_CHARS - CONTEXT_BEFORE - matchLength));
  // Widen if we hit the start/end of the text and still have budget.
  if (end - start < EXCERPT_CHARS) {
    if (start === 0) end = Math.min(text.length, start + EXCERPT_CHARS);
    if (end === text.length) start = Math.max(0, end - EXCERPT_CHARS);
  }
  let excerpt = text.slice(start, end).trim();
  if (start > 0) excerpt = "…" + excerpt;
  if (end < text.length) excerpt = excerpt + "…";
  return excerpt;
}

/**
 * Find mentions of `existingMeds` inside `label`'s interaction/warning
 * sections. One flag per medication, so output stays readable instead of
 * quoting the same warning six times. Every scanned section is checked for
 * the BEST hit before a flag is emitted: a mention inside the boxed warning
 * (the label's strongest warning) always wins; otherwise the earliest
 * section in priority order (drug_interactions, then warnings) is used.
 */
export function findMentions(
  label: LabelData,
  existingMeds: string[],
  checkedDisplayName: string,
): LabelFlag[] {
  const flags: LabelFlag[] = [];
  for (const med of existingMeds) {
    const terms = termsForMedication(med);
    if (!terms.length) continue;
    let best: { sectionLabel: string; term: string; index: number; text: string } | null = null;
    for (const section of SCANNED_SECTIONS) {
      const text = label[section.key];
      if (!text) continue;
      let hit: { term: string; index: number } | null = null;
      for (const term of terms) {
        const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
        const m = re.exec(text);
        if (m && (!hit || m.index < hit.index)) hit = { term, index: m.index };
      }
      if (hit) {
        if (section.key === "boxedWarning") {
          // A boxed-warning mention outranks any other section — stop here.
          best = { sectionLabel: section.label, term: hit.term, index: hit.index, text };
          break;
        }
        if (!best) best = { sectionLabel: section.label, term: hit.term, index: hit.index, text };
      }
    }
    if (best) {
      flags.push({
        existingMedication: med,
        checkedMedication: checkedDisplayName,
        sourceLabel: checkedDisplayName,
        section: best.sectionLabel,
        matchedTerm: best.term,
        excerpt: excerptAround(best.text, best.index, best.term.length),
      });
    }
  }
  return flags;
}

/** The first ~2 sentences / 400 chars of a section, for "top warnings" display. */
export function sectionPreview(text: string | undefined, maxChars = 400): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastPeriod = cut.lastIndexOf(". ");
  return (lastPeriod > maxChars * 0.5 ? cut.slice(0, lastPeriod + 1) : cut).trim() + " …";
}
