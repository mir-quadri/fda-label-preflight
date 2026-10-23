# fda-label-preflight

**Check a new medication against the ones already being taken — in the FDA labels' own words.**

`fda-label-preflight` is a small, dependency-light TypeScript library that answers one
question before a new pill is swallowed: *"Does any FDA label involved here actually
mention this combination?"*

It checks in **both directions**, because label warnings are asymmetric:

1. The **candidate's** FDA label is scanned for mentions of each medication already
   being taken.
2. Each **existing medication's own** FDA label is scanned for a mention of the
   candidate. (This is where the strongest warnings often live — warfarin's label
   names ibuprofen in its bleeding-risk table; ibuprofen's label warns about
   warfarin-type anticoagulants.)

Every flag comes back as a **verbatim quoted excerpt** from the label, with full
provenance: which label it came from, which section, which term matched, and whether
the label was fetched **live from openFDA** or served from the **bundled offline
excerpts**. Nothing is paraphrased into a clinical judgement.

Labels are fetched from the [openFDA](https://open.fda.gov/) drug-label API
(`https://api.fda.gov/drug/label.json`, no API key required) with a 4-second
timeout, a 1-hour in-memory cache, and an automatic fallback to bundled label
excerpts (warfarin, ibuprofen, atorvastatin, metformin, lisinopril, loratadine)
when the network is slow or down. Every result carries its `dataSource` — provenance
is surfaced, never hidden.

## Why this exists

Sourced, quoted FDA-label checking shouldn't be locked inside one product. The
checking engine was originally built for **DoseWise**, a medication preflight +
doctor-visit-brief agent, and is factored out here so any voice agent, chatbot,
community hotline, caregiver tool, or family-safety app can embed it. A
deterministic, offline-capable, explainable detector is exactly the component
smaller builders — senior centres, schools, local nonprofits — can actually adopt:
no LLM costs, no API keys, no black box. When the tool speaks, it quotes the label;
when it finds nothing, it says so and explains why that isn't a clearance.

## ⚠️ Honesty section — read this before shipping anything on top of this

- **This is text-mention detection, not a clinical interaction database.** FDA
  labels are prose. They omit interactions, bury them in tables, use class names
  ("NSAIDs", "ACE inhibitors"), and vary by manufacturer. The engine matches
  specific drug names (plus a small, auditable brand↔generic synonym map) — it
  deliberately does **not** expand class mentions, because a class mention can't
  be attributed to a specific medication without a drug-class database.
- **No mention found ≠ safe.** A clean result means only that the labels retrieved
  don't explicitly name the combination. Labels are incomplete and cannot cover
  every combination.
- **A mention found ≠ proof of harm.** A flag means exactly one thing: *the label
  itself raises this — discuss it with your pharmacist or doctor before taking
  the new medication.*
- **This library never calls a combination "safe"**, and neither should you. Its
  summaries and its `disclaimer` field are written to be shown to end users
  as-is.
- **Advisory only — not medical advice.** This library reads FDA label text; it
  does not replace a pharmacist or doctor. Never start, stop, or change a
  medication based on it.

## Install

```bash
npm install fda-label-preflight
```

Requires Node.js ≥ 20 (uses the global `fetch`). No runtime dependencies.

## Usage

### Preflight a new medication

```ts
import { preflightMedication } from "fda-label-preflight";

const result = await preflightMedication("ibuprofen", ["warfarin", "metformin"]);

console.log(result.summary);
// "Checked in both directions: the FDA label for ibuprofen mentions warfarin
//  (in drug_interactions); and the FDA label for warfarin mentions ibuprofen
//  (in drug_interactions). Treat each mention below as a label flag to discuss
//  with your pharmacist or doctor before taking ibuprofen — a mention is the
//  label raising the combination, not proof of harm, and this check never
//  clears a combination as "safe"."

for (const flag of result.flags) {
  console.log(flag.sourceLabel, flag.section, flag.matchedTerm);
  console.log(flag.excerpt); // verbatim quote from the FDA label
}
```

Real output shape for that call:

```jsonc
{
  "candidate": "ibuprofen",
  "labelFound": true,
  "dataSource": "live openFDA",          // or "bundled label excerpt (offline fallback)"
  "existingMedicationsChecked": ["warfarin", "metformin"],
  "excludedFromCheck": [],               // e.g. the candidate itself, if already on the list
  "labelsNotFound": [],                  // existing meds whose labels couldn't be retrieved
  "flags": [
    {
      "existingMedication": "warfarin",
      "checkedMedication": "ibuprofen",
      "sourceLabel": "ibuprofen",        // the quote came from ibuprofen's label
      "section": "drug_interactions",
      "matchedTerm": "warfarin",
      "excerpt": "…Warfarin-type anticoagulants Several short-term controlled studies failed to show that Ibuprofen tablets significantly affected prothrombin times or a variety of other clotting factors when…"
    },
    {
      "existingMedication": "ibuprofen",
      "checkedMedication": "warfarin",
      "sourceLabel": "warfarin",         // …and this one from warfarin's label
      "section": "drug_interactions",
      "matchedTerm": "ibuprofen",
      "excerpt": "…Non-steroidal Anti-Inflammatory Agents celecoxib, diclofenac, diflunisal, fenoprofen, ibuprofen, indomethacin, ketoprofen…"
    }
  ],
  "flagGroups": [ /* the same flags, grouped by sourceLabel */ ],
  "boxedWarningPresent": true,
  "boxedWarningExcerpt": "…",
  "topWarnings": "…",
  "summary": "Checked in both directions: …",
  "disclaimer": "Advisory only — not medical advice. …"
}
```

Brand names work on either side — `"Coumadin"` on the list still matches
`"warfarin"` in a label, and vice versa (`"Advil"` → ibuprofen), via the synonym
map in `MED_SYNONYMS`.

A medication is never checked against its own label: if the candidate is already
on the list (matched canonically, so brand names count), it is moved to
`excludedFromCheck` and the exclusion is reported in the summary, not hidden.

### Look up one medication's label facts

```ts
import { getLabelFacts } from "fda-label-preflight";

const facts = await getLabelFacts("Coumadin");
facts.labelFound;        // true
facts.canonicalName;     // "warfarin"
facts.dataSource;        // "live openFDA" | "bundled label excerpt (offline fallback)"
facts.whatItIsFor;       // preview of the label's indications section
facts.boxedWarningPresent; // true — warfarin carries a bleeding-risk boxed warning
facts.boxedWarningExcerpt; // quoted preview of that warning
```

## API reference

### `preflightMedication(candidate, existing, opts?): Promise<PreflightResult>`

The headline check.

- `candidate: string` — the NEW medication (brand or generic).
- `existing: string[]` — medications already being taken (brand or generic).
- `opts.direction?: "both" | "candidate-label-only"` — `"both"` (default) runs the
  full bidirectional check; `"candidate-label-only"` scans only the candidate's
  label.

### `getLabelFacts(name): Promise<LabelFacts>`

Single-drug lookup. Returns the label's key sections as quoted previews
(`whatItIsFor`, `boxedWarningExcerpt`, `topWarnings`, `drugInteractionsPreview`),
the canonical/brand/generic names, provenance, and the advisory disclaimer.
`labelFound: false` means neither live openFDA nor the bundled excerpts know the
drug — a coverage gap, not a statement about the medication.

### `PreflightResult`

| Field | Meaning |
|---|---|
| `candidate` | The candidate name as given. |
| `labelFound` | Whether any label was found for the candidate. `false` ⇒ no check was performed; the summary says so. |
| `dataSource?` | `"live openFDA"` or `"bundled label excerpt (offline fallback)"` for the candidate's label. |
| `existingMedicationsChecked` | List entries actually checked (after exclusions). |
| `excludedFromCheck` | Entries excluded because they ARE the candidate (same drug). |
| `labelsNotFound` | Existing medications whose own labels couldn't be retrieved (their direction went unchecked — stated in the summary). |
| `flags` | All `LabelFlag`s, both directions, flat. |
| `flagGroups` | The same flags grouped by `sourceLabel`, each group with its own `dataSource`. |
| `boxedWarningPresent` / `boxedWarningExcerpt?` | Whether the candidate's label carries a boxed warning, and a quoted preview. |
| `topWarnings?` | Quoted preview of the candidate label's warnings section. |
| `summary` | Plain-language, user-safe summary. Never claims safety. |
| `disclaimer` | The advisory disclaimer — show it to users. |

### `LabelFlag`

| Field | Meaning |
|---|---|
| `existingMedication` | Display name of the medication already on the list (or, in the reverse direction, the candidate). |
| `checkedMedication` | The medication being checked when the flag was raised. |
| `sourceLabel` | The medication whose FDA label the quote came from — the provenance of the quote. |
| `section` | Label section: `drug_interactions`, `warnings`, or `boxed_warning`. |
| `matchedTerm` | The exact label term that matched (e.g. `"warfarin"`, or `"ibuprofen"` when the list said "Advil"). |
| `excerpt` | Verbatim quote from the label around the mention (≤ ~300 chars, `…`-marked when truncated). |

Flag selection: one flag per medication — a mention in the **boxed warning**
(the label's strongest warning) outranks other sections; otherwise
`drug_interactions` wins over `warnings`.

### Lower-level exports

For builders who want the primitives:

- `runPreflight(candidate, existing)` — the bidirectional check, unconfigured.
- `preflightLabel(candidate, label, dataSource, existing)` — single-direction
  scan of an already-fetched label.
- `findMentions(label, existingMeds, checkedDisplayName)` — the matching engine.
- `fetchLabel(name)` — the openFDA client: 4 s timeout, 1 h LRU cache
  (max 100 entries), best-label scoring (single-ingredient match + richest
  interactions text), query sanitisation, fixture fallback. Returns
  `LabelResult | null`.
- `getLabelFacts` / `sectionPreview` / `excerptAround` — display helpers.
- `normalizeMedName` / `canonicalMedName` / `termsForMedication` / `MED_SYNONYMS`
  — name handling.
- `LABEL_FIXTURES` — the bundled label excerpts, keyed by canonical name.
- `clearLabelCache()` — clears the in-memory label cache.
- Types: `LabelData`, `LabelResult`, `LabelFlag`, `DataSource`, `FlagGroup`,
  `LabelFacts`, `PreflightOptions`.

## The bundled fixtures

`src/fda/fixtures.ts` contains label excerpts for warfarin, ibuprofen,
atorvastatin, metformin, lisinopril, and loratadine, quoted verbatim from the
drugs' official FDA labels as returned by openFDA on 2026-10-22 (long sections
trimmed at sentence boundaries — excerpts, not complete sections). They exist
so the library and its tests work fully offline; whenever the live API is
reachable it is preferred, and results say which source was used.

## Development

```bash
npm install
npm test        # vitest — engine, client fallback paths, public API
npm run build   # tsc → dist/ (with type declarations)
npm run typecheck
```

## License

MIT © 2026 Mir Quadri. See [LICENSE](./LICENSE).

FDA label data is from the U.S. Food and Drug Administration via
[openFDA](https://open.fda.gov/); openFDA's own terms apply to the data. This
library is not affiliated with or endorsed by the FDA.
