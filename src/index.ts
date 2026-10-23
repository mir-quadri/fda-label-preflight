/**
 * fda-label-preflight — public API.
 *
 * Check a NEW medication against the medications someone already takes, in
 * the FDA labels' own words: the candidate's label is scanned for mentions
 * of the existing medications, and each existing medication's label is
 * scanned for a mention of the candidate (warnings are asymmetric — both
 * directions matter). Every flag is a verbatim quoted excerpt with full
 * provenance (which label, which section, which term matched, and whether
 * the label came from live openFDA or the bundled offline excerpts).
 *
 * Language discipline: flags are "label flags to discuss with your
 * pharmacist or doctor". This library NEVER calls a combination "safe" —
 * FDA label text is incomplete, varies by manufacturer, and cannot cover
 * every combination. See the README's honesty section before shipping
 * anything on top of this.
 */
import { fetchLabel, _clearLabelCache } from "./fda/client.js";
import type { PreflightResult } from "./engine/preflight.js";
import { preflightLabel, runPreflight } from "./engine/preflight.js";

export interface PreflightOptions {
  /**
   * "both" (default): the full bidirectional check — candidate label
   * scanned for the existing medications AND each existing medication's
   * label scanned for the candidate.
   * "candidate-label-only": scan only the candidate's own label.
   */
  direction?: "both" | "candidate-label-only";
}

/**
 * The headline check: preflight a candidate medication against a list of
 * medications already being taken.
 *
 * @param candidate  The NEW medication (brand or generic name).
 * @param existing   Medications already being taken (brand or generic).
 * @param opts       See PreflightOptions.
 */
export async function preflightMedication(
  candidate: string,
  existing: string[],
  opts: PreflightOptions = {},
): Promise<PreflightResult> {
  if (opts.direction === "candidate-label-only") {
    const found = await fetchLabel(candidate);
    // No candidate label anywhere: runPreflight produces the honest
    // labelFound:false result for exactly this case, so defer to it.
    if (!found) return runPreflight(candidate, existing);
    return preflightLabel(candidate, found.label, found.dataSource, existing);
  }
  return runPreflight(candidate, existing);
}

export { getLabelFacts } from "./facts.js";
export type { LabelFacts } from "./facts.js";

export {
  runPreflight,
  preflightLabel,
  partitionExisting,
  ADVISORY_DISCLAIMER,
  NO_MENTION_CAVEAT,
} from "./engine/preflight.js";
export type { PreflightResult, FlagGroup } from "./engine/preflight.js";

export { findMentions, excerptAround, sectionPreview } from "./engine/matching.js";
export { fetchLabel, sanitizeQueryTerm, scoreCandidate } from "./fda/client.js";
export { LABEL_FIXTURES } from "./fda/fixtures.js";
export {
  normalizeMedName,
  canonicalMedName,
  termsForMedication,
  MED_SYNONYMS,
} from "./fda/names.js";
export type { LabelData, LabelResult, LabelFlag, DataSource } from "./fda/types.js";

/** Clear the in-memory label cache (e.g. in tests, or to force a refetch). */
export function clearLabelCache(): void {
  _clearLabelCache();
}
