/**
 * Plain-language facts from one medication's FDA label.
 *
 * This is the library's "look up a single drug" entry point: it returns the
 * label's own statements — what the drug is for, its boxed warning (if any),
 * top warnings, and the start of its drug-interactions section — each
 * trimmed at a sentence boundary, with the data provenance attached. It
 * summarises NOTHING clinically: the text is the label's, quoted.
 */
import { fetchLabel } from "./fda/client.js";
import type { DataSource } from "./fda/types.js";
import { sectionPreview } from "./engine/matching.js";
import { ADVISORY_DISCLAIMER } from "./engine/preflight.js";

export interface LabelFacts {
  /** The name as queried (brand or generic). */
  name: string;
  labelFound: boolean;
  /** Where the label came from — always surfaced, never hidden. */
  dataSource?: DataSource;
  /** Canonical generic name of the label that was found. */
  canonicalName?: string;
  brandNames: string[];
  genericNames: string[];
  /** Preview of the label's indications_and_usage section. */
  whatItIsFor?: string;
  boxedWarningPresent: boolean;
  /** Preview of the boxed warning, when the label carries one. */
  boxedWarningExcerpt?: string;
  /** Preview of the warnings section. */
  topWarnings?: string;
  /** Preview of the drug_interactions section. */
  drugInteractionsPreview?: string;
  disclaimer: string;
}

/**
 * Look up one medication's FDA label (live openFDA, else the bundled
 * offline excerpt) and return its key sections as plain facts.
 * `labelFound: false` means neither source knows the drug — a coverage
 * gap, not a statement about the medication.
 */
export async function getLabelFacts(name: string): Promise<LabelFacts> {
  const found = await fetchLabel(name);
  if (!found) {
    return {
      name,
      labelFound: false,
      brandNames: [],
      genericNames: [],
      boxedWarningPresent: false,
      disclaimer: ADVISORY_DISCLAIMER,
    };
  }
  const { label, dataSource } = found;
  return {
    name,
    labelFound: true,
    dataSource,
    canonicalName: label.name,
    brandNames: label.brandNames,
    genericNames: label.genericNames,
    ...(sectionPreview(label.indicationsAndUsage) ? { whatItIsFor: sectionPreview(label.indicationsAndUsage) } : {}),
    boxedWarningPresent: Boolean(label.boxedWarning),
    ...(label.boxedWarning ? { boxedWarningExcerpt: sectionPreview(label.boxedWarning, 500) } : {}),
    ...(sectionPreview(label.warnings) ? { topWarnings: sectionPreview(label.warnings) } : {}),
    ...(sectionPreview(label.drugInteractions) ? { drugInteractionsPreview: sectionPreview(label.drugInteractions) } : {}),
    disclaimer: ADVISORY_DISCLAIMER,
  };
}
