/**
 * Shared shapes for FDA drug-label data, whether it came from the live
 * openFDA API or from the bundled offline fixtures.
 */

/** One drug's label, normalised to the sections the preflight engine actually uses. */
export interface LabelData {
  /** Canonical display name (usually the generic name, lower-cased). */
  name: string;
  brandNames: string[];
  genericNames: string[];
  boxedWarning?: string;
  indicationsAndUsage?: string;
  drugInteractions?: string;
  /** `warnings` (OTC labels) or `warnings_and_cautions` (Rx labels). */
  warnings?: string;
  dosageAndAdministration?: string;
}

export type DataSource = "live openFDA" | "bundled label excerpt (offline fallback)";

export interface LabelResult {
  label: LabelData;
  dataSource: DataSource;
}

/**
 * A mention of an existing medication found inside a label section.
 * The excerpt is a verbatim quote from the FDA label (<= ~300 chars).
 */
export interface LabelFlag {
  /** Display name of the medication already on the profile's list. */
  existingMedication: string;
  /** Canonical name of the medication whose label was being checked. */
  checkedMedication: string;
  /**
   * The medication whose FDA label this flag was found IN — the provenance
   * of the quote ("from ibuprofen's label" vs "from warfarin's label").
   * Preflight checks both directions, so this is not always the candidate.
   */
  sourceLabel: string;
  /** Label section the mention was found in, e.g. "drug_interactions". */
  section: string;
  /** The exact term from the label that matched (e.g. "warfarin"). */
  matchedTerm: string;
  /** Verbatim quoted excerpt from the label around the mention. */
  excerpt: string;
}
