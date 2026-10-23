/**
 * Medication name handling: normalisation + a small synonym map for common
 * drugs, so "Coumadin" on a list still matches "warfarin" in a label (and
 * vice versa). Deliberately small and auditable — this is a matching aid,
 * not a drug database.
 */

const TRAILING_FORM_WORDS =
  /\s+(sodium|calcium|hydrochloride|hcl|potassium|phosphate|succinate|tablets?|capsules?|extended release|er|xr)$/i;

/** Lowercase, trim, collapse whitespace, drop trailing salt/form words. */
export function normalizeMedName(raw: string): string {
  let name = raw.trim().toLowerCase().replace(/\s+/g, " ");
  // Strip ONE trailing salt/form word at a time, looping until stable, so
  // stacked forms collapse fully: "warfarin sodium tablets" -> "warfarin",
  // "metformin hydrochloride tablets" -> "metformin".
  let previous: string;
  do {
    previous = name;
    name = name.replace(TRAILING_FORM_WORDS, "").trim();
  } while (name !== previous);
  return name;
}

/**
 * Canonical name -> also-known-as terms. Keys and values are normalised
 * generic/brand names. Matching checks the canonical name plus every alias.
 */
export const MED_SYNONYMS: Record<string, string[]> = {
  warfarin: ["coumadin", "jantoven"],
  atorvastatin: ["lipitor"],
  metformin: ["glucophage"],
  lisinopril: ["zestril", "prinivil"],
  ibuprofen: ["advil", "motrin"],
  aspirin: ["bayer aspirin", "ecotrin"],
  acetaminophen: ["tylenol", "paracetamol"],
  amoxicillin: ["amoxil"],
  sertraline: ["zoloft"],
  omeprazole: ["prilosec"],
};

/** Reverse lookup: alias -> canonical name. */
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(MED_SYNONYMS)) {
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(alias, canonical);
}

/** The canonical name for a medication, resolving known brand aliases. */
export function canonicalMedName(raw: string): string {
  const n = normalizeMedName(raw);
  return ALIAS_TO_CANONICAL.get(n) ?? n;
}

/**
 * Every term that should count as a mention of this medication in label
 * text: the name as given (normalised), its canonical form, and all known
 * synonyms of that canonical form.
 */
export function termsForMedication(rawName: string): string[] {
  const terms = new Set<string>();
  const normalized = normalizeMedName(rawName);
  const canonical = canonicalMedName(rawName);
  terms.add(normalized);
  terms.add(canonical);
  for (const alias of MED_SYNONYMS[canonical] ?? []) terms.add(alias);
  return [...terms].filter((t) => t.length >= 3);
}
