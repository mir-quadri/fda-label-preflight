import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LABEL_FIXTURES } from "../src/fda/fixtures.js";
import { canonicalMedName, normalizeMedName, termsForMedication } from "../src/fda/names.js";
import { excerptAround, findMentions } from "../src/engine/matching.js";
import { preflightLabel, runPreflight } from "../src/engine/preflight.js";
import { _clearLabelCache } from "../src/fda/client.js";

const FALLBACK = "bundled label excerpt (offline fallback)" as const;

describe("name normalisation + synonyms", () => {
  it("normalises case, whitespace and salt suffixes", () => {
    expect(normalizeMedName("  Warfarin Sodium ")).toBe("warfarin");
    expect(normalizeMedName("METFORMIN   HYDROCHLORIDE")).toBe("metformin");
  });

  it("strips stacked salt/form suffixes until stable", () => {
    expect(normalizeMedName("warfarin sodium tablets")).toBe("warfarin");
    expect(normalizeMedName("metformin hydrochloride tablets")).toBe("metformin");
    expect(normalizeMedName("atorvastatin calcium tablets")).toBe("atorvastatin");
    expect(normalizeMedName("Warfarin Sodium Tablets")).toBe("warfarin");
    expect(canonicalMedName("warfarin sodium tablets")).toBe("warfarin");
  });

  it("resolves brand names to canonical generics", () => {
    expect(canonicalMedName("Coumadin")).toBe("warfarin");
    expect(canonicalMedName("Lipitor")).toBe("atorvastatin");
    expect(canonicalMedName("Tylenol")).toBe("acetaminophen");
    expect(canonicalMedName("Advil")).toBe("ibuprofen");
  });

  it("expands a medication into all match terms", () => {
    const terms = termsForMedication("warfarin");
    expect(terms).toContain("warfarin");
    expect(terms).toContain("coumadin");
    expect(termsForMedication("Advil")).toContain("ibuprofen");
  });
});

describe("bundled fixtures (real FDA label excerpts)", () => {
  it("ships fixtures for the five demo medications", () => {
    for (const name of ["warfarin", "ibuprofen", "atorvastatin", "metformin", "lisinopril"]) {
      expect(LABEL_FIXTURES[name], name).toBeDefined();
      expect(LABEL_FIXTURES[name].drugInteractions!.length).toBeGreaterThan(500);
    }
  });

  it("ibuprofen's real label mentions warfarin-type anticoagulants", () => {
    expect(LABEL_FIXTURES.ibuprofen.drugInteractions).toMatch(/warfarin/i);
  });

  it("warfarin's real label lists ibuprofen among interacting NSAIDs", () => {
    expect(LABEL_FIXTURES.warfarin.drugInteractions).toMatch(/ibuprofen/i);
  });

  it("warfarin and metformin fixtures carry their real boxed warnings", () => {
    expect(LABEL_FIXTURES.warfarin.boxedWarning).toMatch(/bleeding/i);
    expect(LABEL_FIXTURES.metformin.boxedWarning).toMatch(/lactic acidosis/i);
  });
});

describe("mention-matching engine", () => {
  it("flags ibuprofen (candidate) against warfarin (existing), with a quoted excerpt", () => {
    const flags = findMentions(LABEL_FIXTURES.ibuprofen, ["warfarin"], "ibuprofen");
    expect(flags.length).toBe(1);
    expect(flags[0].existingMedication).toBe("warfarin");
    expect(flags[0].section).toBe("drug_interactions");
    expect(flags[0].excerpt).toMatch(/warfarin/i);
    expect(flags[0].excerpt.length).toBeLessThanOrEqual(302);
  });

  it("matches by brand name too: warfarin label flags 'Advil' via the ibuprofen synonym", () => {
    const flags = findMentions(LABEL_FIXTURES.warfarin, ["Advil"], "warfarin");
    expect(flags.length).toBe(1);
    expect(flags[0].matchedTerm).toBe("ibuprofen");
  });

  it("matches an existing med recorded under its brand name (Coumadin)", () => {
    const flags = findMentions(LABEL_FIXTURES.ibuprofen, ["Coumadin"], "ibuprofen");
    expect(flags.length).toBe(1);
    expect(flags[0].matchedTerm).toBe("warfarin");
  });

  it("returns no flags when the label never mentions the existing meds", () => {
    const flags = findMentions(LABEL_FIXTURES.atorvastatin, ["paracetamol-zzz", "nonexistentdrug"], "atorvastatin");
    expect(flags).toEqual([]);
  });

  it("prefers a boxed_warning mention over an interactions mention (P2-5)", () => {
    const label = {
      name: "synthetic",
      brandNames: [],
      genericNames: ["synthetic"],
      drugInteractions: "Synthetic interacts with warfarin per this section.",
      warnings: "No relevant names here.",
      boxedWarning: "BOXED: synthetic with warfarin can cause severe bleeding.",
    };
    const flags = findMentions(label, ["warfarin"], "synthetic");
    expect(flags.length).toBe(1);
    expect(flags[0].section).toBe("boxed_warning");
    expect(flags[0].sourceLabel).toBe("synthetic");
    expect(flags[0].excerpt).toMatch(/severe bleeding/);
  });

  it("excerptAround centres the quote and marks truncation", () => {
    const text = "x".repeat(500) + " warfarin " + "y".repeat(500);
    const ex = excerptAround(text, 501, 8);
    expect(ex).toContain("warfarin");
    expect(ex.startsWith("…")).toBe(true);
    expect(ex.endsWith("…")).toBe(true);
    expect(ex.length).toBeLessThanOrEqual(302);
  });
});

describe("preflight (offline, fixture labels)", () => {
  it("ibuprofen vs warfarin: flags with quote, boxed warning surfaced, never says 'safe'", async () => {
    const r = await preflightLabel("ibuprofen", LABEL_FIXTURES.ibuprofen, FALLBACK, ["warfarin", "metformin", "lisinopril"]);
    expect(r.flags.length).toBeGreaterThanOrEqual(1);
    const flag = r.flags.find((f) => f.existingMedication === "warfarin");
    expect(flag).toBeDefined();
    expect(flag!.excerpt).toMatch(/warfarin/i);
    expect(r.boxedWarningPresent).toBe(true);
    expect(r.dataSource).toBe(FALLBACK);
    expect(r.summary).not.toMatch(/is safe|safe to take/i);
    expect(r.summary).toMatch(/discuss with your pharmacist/i);
    expect(r.disclaimer).toMatch(/not medical advice/i);
  });

  it("no mentions found: says exactly that, with the not-a-guarantee caveat", async () => {
    const r = await preflightLabel("atorvastatin", LABEL_FIXTURES.atorvastatin, FALLBACK, ["nonexistentdrug"]);
    expect(r.flags).toEqual([]);
    expect(r.summary).toMatch(/No explicit mention/);
    expect(r.summary).toMatch(/not a guarantee of safety/i);
  });
});

describe("bidirectional preflight (offline, fixture labels)", () => {
  beforeEach(() => {
    _clearLabelCache();
    // Force the offline fixture path so both directions are deterministic.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline in tests");
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _clearLabelCache();
  });

  it("ibuprofen vs [warfarin] produces flags from BOTH labels, grouped by source", async () => {
    const r = await runPreflight("ibuprofen", ["warfarin"]);
    expect(r.labelFound).toBe(true);
    expect(r.flagGroups.length).toBe(2);
    const fromCandidate = r.flagGroups.find((g) => g.sourceLabel === "ibuprofen");
    const fromExisting = r.flagGroups.find((g) => g.sourceLabel === "warfarin");
    expect(fromCandidate, JSON.stringify(r.flagGroups)).toBeDefined();
    expect(fromExisting, JSON.stringify(r.flagGroups)).toBeDefined();
    // From ibuprofen's label: it mentions warfarin.
    expect(fromCandidate!.flags[0].existingMedication).toBe("warfarin");
    expect(fromCandidate!.flags[0].excerpt).toMatch(/warfarin/i);
    expect(fromCandidate!.dataSource).toBe(FALLBACK);
    // From warfarin's label: it names ibuprofen (the asymmetric direction).
    expect(fromExisting!.flags[0].existingMedication).toBe("ibuprofen");
    expect(fromExisting!.flags[0].excerpt).toMatch(/ibuprofen/i);
    expect(fromExisting!.dataSource).toBe(FALLBACK);
    expect(r.flags.length).toBe(2);
    expect(r.summary).toMatch(/both directions/i);
    expect(r.summary).toMatch(/label for warfarin mentions ibuprofen/i);
    expect(r.summary).not.toMatch(/is safe|safe to take/i);
  });

  it("empty list: the summary itself leads with 'No check was performed'", async () => {
    const r = await runPreflight("ibuprofen", []);
    expect(r.flags).toEqual([]);
    expect(r.summary).toMatch(/^No check was performed — this profile's medication list is empty/);
    const viaLabel = await preflightLabel("ibuprofen", LABEL_FIXTURES.ibuprofen, FALLBACK, []);
    expect(viaLabel.summary).toMatch(/^No check was performed/);
  });

  it("excludes the candidate itself from the check (canonically, brand names count)", async () => {
    const r = await runPreflight("ibuprofen", ["ibuprofen", "warfarin"]);
    expect(r.excludedFromCheck).toEqual(["ibuprofen"]);
    expect(r.existingMedicationsChecked).toEqual(["warfarin"]);
    const brand = await runPreflight("Advil", ["ibuprofen"]);
    expect(brand.excludedFromCheck).toEqual(["ibuprofen"]);
    expect(brand.existingMedicationsChecked).toEqual([]);
    expect(brand.summary).toMatch(/^No check was performed/);
  });

  it("J4 no-flag case: loratadine vs the demo list finds no mention in either direction", async () => {
    const r = await runPreflight("loratadine", ["warfarin", "metformin", "lisinopril"]);
    expect(r.labelFound).toBe(true);
    expect(r.flags).toEqual([]);
    expect(r.flagGroups).toEqual([]);
    expect(r.summary).toMatch(/No explicit mention/);
    expect(r.summary).toMatch(/not a guarantee of safety/i);
  });
});
