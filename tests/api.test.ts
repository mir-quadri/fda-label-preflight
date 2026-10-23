import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { preflightMedication, getLabelFacts, clearLabelCache } from "../src/index.js";

const FALLBACK = "bundled label excerpt (offline fallback)" as const;

// Force the deterministic offline-fixture path for the whole file.
beforeEach(() => {
  clearLabelCache();
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
  clearLabelCache();
});

describe("public API: preflightMedication", () => {
  it("defaults to the bidirectional check (flags from both labels)", async () => {
    const r = await preflightMedication("ibuprofen", ["warfarin"]);
    expect(r.labelFound).toBe(true);
    expect(r.flagGroups.length).toBe(2);
    expect(r.dataSource).toBe(FALLBACK);
    expect(r.summary).not.toMatch(/is safe|safe to take/i);
  });

  it("direction: 'candidate-label-only' scans just the candidate's label", async () => {
    const r = await preflightMedication("ibuprofen", ["warfarin"], {
      direction: "candidate-label-only",
    });
    expect(r.flagGroups.length).toBe(1);
    expect(r.flagGroups[0].sourceLabel).toBe("ibuprofen");
    expect(r.flags.length).toBe(1);
  });
});

describe("public API: getLabelFacts", () => {
  it("returns quoted label sections with provenance for a fixture drug", async () => {
    const f = await getLabelFacts("warfarin");
    expect(f.labelFound).toBe(true);
    expect(f.dataSource).toBe(FALLBACK);
    expect(f.canonicalName).toBe("warfarin");
    expect(f.boxedWarningPresent).toBe(true);
    expect(f.boxedWarningExcerpt).toMatch(/bleeding/i);
    expect(f.whatItIsFor).toMatch(/thrombosis|embolism/i);
    expect(f.disclaimer).toMatch(/not medical advice/i);
  });

  it("resolves a brand name (Coumadin) to the warfarin label", async () => {
    const f = await getLabelFacts("Coumadin");
    expect(f.labelFound).toBe(true);
    expect(f.canonicalName).toBe("warfarin");
  });

  it("unknown drug: labelFound false, no facts invented", async () => {
    const f = await getLabelFacts("nonexistentdrug-zzz");
    expect(f.labelFound).toBe(false);
    expect(f.whatItIsFor).toBeUndefined();
    expect(f.boxedWarningPresent).toBe(false);
  });
});
