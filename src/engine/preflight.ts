/**
 * Preflight orchestration: the headline check.
 *
 * "Before you swallow" — given a NEW candidate medication and the list of
 * medications a profile already takes, check the labels in BOTH directions:
 *
 *  1. The candidate's FDA label is scanned for mentions of each existing
 *     medication ("from ibuprofen's label").
 *  2. Each existing medication's OWN FDA label is scanned for a mention of
 *     the candidate ("from warfarin's label").
 *
 * Both directions matter because label warnings are asymmetric: warfarin's
 * label warns about NSAIDs as a class and names ibuprofen in its bleeding-
 * risk table, while ibuprofen's label warns about warfarin-type
 * anticoagulants. Reading only the new pill's label misses half the story.
 *
 * Language discipline (non-negotiable):
 *  - Flags are "label flags to discuss with your pharmacist or doctor".
 *  - We NEVER say a combination is safe. When nothing is found we say
 *    exactly that nothing was found, and that labels are incomplete.
 */
import { fetchLabel } from "../fda/client.js";
import { canonicalMedName } from "../fda/names.js";
import type { DataSource, LabelData, LabelFlag } from "../fda/types.js";
import { findMentions, sectionPreview } from "./matching.js";

export const ADVISORY_DISCLAIMER =
  "Advisory only — not medical advice. This check reads FDA label text; it does not replace your pharmacist or doctor. Never start, stop, or change a medication based on this tool — discuss every flag, and every new medication, with them first.";

export const NO_MENTION_CAVEAT =
  "that is not a guarantee of safety: FDA labels are incomplete, vary by manufacturer, and cannot cover every combination. Always confirm a new medication with your pharmacist or doctor.";

/** All flags found in ONE label, grouped by that label (the quote's source). */
export interface FlagGroup {
  /** Display name of the medication whose label these flags came from. */
  sourceLabel: string;
  /** Provenance of that label (live vs bundled excerpt), when fetched. */
  dataSource?: DataSource;
  flags: LabelFlag[];
}

export interface PreflightResult {
  candidate: string;
  labelFound: boolean;
  dataSource?: DataSource;
  existingMedicationsChecked: string[];
  /** List entries excluded from the check (e.g. the candidate itself). */
  excludedFromCheck: string[];
  /** Existing medications whose own labels could not be retrieved. */
  labelsNotFound: string[];
  flags: LabelFlag[];
  /** The same flags, grouped by the label they were quoted from. */
  flagGroups: FlagGroup[];
  boxedWarningPresent: boolean;
  boxedWarningExcerpt?: string;
  topWarnings?: string;
  summary: string;
  disclaimer: string;
}

/**
 * Split the profile's list into medications to check against and entries to
 * exclude. A medication is never checked against its OWN label: if the
 * candidate is already on the list (same drug, matched canonically so brand
 * names count), it is excluded and the exclusion is reported, not hidden.
 */
export function partitionExisting(
  candidate: string,
  existingMeds: string[],
): { toCheck: string[]; excluded: string[] } {
  const candidateCanonical = canonicalMedName(candidate);
  const toCheck: string[] = [];
  const excluded: string[] = [];
  for (const med of existingMeds) {
    if (canonicalMedName(med) === candidateCanonical) excluded.push(med);
    else toCheck.push(med);
  }
  return { toCheck, excluded };
}

function buildSummary(args: {
  candidate: string;
  toCheck: string[];
  excluded: string[];
  groups: FlagGroup[];
  labelsNotFound: string[];
  bidirectional: boolean;
}): string {
  const { candidate, toCheck, excluded, groups, labelsNotFound, bidirectional } = args;
  if (!toCheck.length) {
    const excludedNote = excluded.length
      ? ` The only ${excluded.length === 1 ? "entry" : "entries"} on the list ${excluded.length === 1 ? "is" : "are"} ${excluded.join(", ")} — the candidate itself, which is never checked against its own label.`
      : "";
    return (
      `No check was performed — this profile's medication list is empty, so there was nothing to check the ${candidate} label against.${excludedNote} ` +
      `Add the medications already being taken to the list you pass the preflight, then run it again. Nothing here is a safety result — ${NO_MENTION_CAVEAT}`
    );
  }
  const parts: string[] = [];
  const allFlags = groups.flatMap((g) => g.flags);
  if (allFlags.length) {
    const perGroup = groups
      .map(
        (g) =>
          `the FDA label for ${g.sourceLabel} mentions ${g.flags
            .map((f) => `${f.existingMedication} (in ${f.section})`)
            .join("; ")}`,
      )
      .join("; and ");
    parts.push(
      `${bidirectional ? "Checked in both directions: " : ""}${perGroup}. Treat each mention below as a label flag to discuss with your pharmacist or doctor before taking ${candidate} — a mention is the label raising the combination, not proof of harm, and this check never clears a combination as "safe".`,
    );
  } else if (bidirectional) {
    parts.push(
      `No explicit mention of ${toCheck.join(", ")} was found in the ${candidate} label's interaction or warnings sections, and no mention of ${candidate} was found in the labels of ${toCheck.join(", ")} — ${NO_MENTION_CAVEAT}`,
    );
  } else {
    parts.push(
      `No explicit mention of ${toCheck.join(", ")} was found in the ${candidate} label's interaction or warnings sections — ${NO_MENTION_CAVEAT}`,
    );
  }
  if (excluded.length) {
    parts.push(
      `Excluded from the check: ${excluded.join(", ")} — already on the list as the same medication as the candidate, and a medication is not checked against its own label.`,
    );
  }
  if (labelsNotFound.length) {
    parts.push(
      `The FDA labels for ${labelsNotFound.join(", ")} could not be retrieved, so their labels could not be checked for a mention of ${candidate} — one more reason a no-flag result is not a safety clearance.`,
    );
  }
  return parts.join(" ");
}

function resultFromGroups(args: {
  candidate: string;
  label: LabelData;
  dataSource: DataSource;
  toCheck: string[];
  excluded: string[];
  labelsNotFound: string[];
  groups: FlagGroup[];
  bidirectional: boolean;
}): PreflightResult {
  const { candidate, label, dataSource, toCheck, excluded, labelsNotFound, groups, bidirectional } = args;
  return {
    candidate,
    labelFound: true,
    dataSource,
    existingMedicationsChecked: toCheck,
    excludedFromCheck: excluded,
    labelsNotFound,
    flags: groups.flatMap((g) => g.flags),
    flagGroups: groups,
    boxedWarningPresent: Boolean(label.boxedWarning),
    ...(label.boxedWarning ? { boxedWarningExcerpt: sectionPreview(label.boxedWarning, 500) } : {}),
    ...(sectionPreview(label.warnings) ? { topWarnings: sectionPreview(label.warnings) } : {}),
    summary: buildSummary({ candidate, toCheck, excluded, groups, labelsNotFound, bidirectional }),
    disclaimer: ADVISORY_DISCLAIMER,
  };
}

/**
 * Single-direction core: scan ONE label (the candidate's) for mentions of
 * the existing medications. Used directly by tests; runPreflight builds the
 * full bidirectional check on top of the same primitives.
 */
export async function preflightLabel(
  candidate: string,
  label: LabelData,
  dataSource: DataSource,
  existingMeds: string[],
): Promise<PreflightResult> {
  const { toCheck, excluded } = partitionExisting(candidate, existingMeds);
  const flags = findMentions(label, toCheck, candidate);
  const groups: FlagGroup[] = flags.length ? [{ sourceLabel: candidate, dataSource, flags }] : [];
  return resultFromGroups({
    candidate,
    label,
    dataSource,
    toCheck,
    excluded,
    labelsNotFound: [],
    groups,
    bidirectional: false,
  });
}

/**
 * Full preflight: fetch the candidate's label (live, else fixture), scan it
 * for the existing medications — AND fetch each existing medication's label
 * and scan it for the candidate. Warnings are asymmetric, so both
 * directions are checked and flags are grouped by the label they came from.
 */
export async function runPreflight(candidate: string, existingMeds: string[]): Promise<PreflightResult> {
  const { toCheck, excluded } = partitionExisting(candidate, existingMeds);
  const found = await fetchLabel(candidate);
  if (!found) {
    return {
      candidate,
      labelFound: false,
      existingMedicationsChecked: toCheck,
      excludedFromCheck: excluded,
      labelsNotFound: [],
      flags: [],
      flagGroups: [],
      boxedWarningPresent: false,
      summary: `No FDA label could be found for "${candidate}" in openFDA or in the bundled label excerpts, so no preflight was performed. That is a coverage gap, not a safety result — ask your pharmacist to check this medication against your list before taking it.`,
      disclaimer: ADVISORY_DISCLAIMER,
    };
  }

  const groups: FlagGroup[] = [];

  // Direction 1: the candidate's label, scanned for the existing medications.
  const candidateFlags = findMentions(found.label, toCheck, candidate);
  if (candidateFlags.length) {
    groups.push({ sourceLabel: candidate, dataSource: found.dataSource, flags: candidateFlags });
  }

  // Direction 2: each existing medication's own label, scanned for the
  // candidate. This is where class/table warnings live (e.g. warfarin's
  // label naming ibuprofen among the NSAIDs that raise bleeding risk).
  const labelsNotFound: string[] = [];
  for (const med of toCheck) {
    const medFound = await fetchLabel(med);
    if (!medFound) {
      labelsNotFound.push(med);
      continue;
    }
    const reverseFlags = findMentions(medFound.label, [candidate], med);
    if (reverseFlags.length) {
      groups.push({ sourceLabel: med, dataSource: medFound.dataSource, flags: reverseFlags });
    }
  }

  return resultFromGroups({
    candidate,
    label: found.label,
    dataSource: found.dataSource,
    toCheck,
    excluded,
    labelsNotFound,
    groups,
    bidirectional: true,
  });
}
