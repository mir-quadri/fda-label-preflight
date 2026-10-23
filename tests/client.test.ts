import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchLabel,
  sanitizeQueryTerm,
  scoreCandidate,
  _clearLabelCache,
} from "../src/fda/client.js";

const FALLBACK = "bundled label excerpt (offline fallback)" as const;
const LIVE = "live openFDA" as const;

/** Minimal openFDA-shaped label payload. */
function rawLabel(generic: string, extra: Record<string, string[]> = {}) {
  return {
    openfda: { generic_name: [generic], brand_name: [`${generic} brand`] },
    indications_and_usage: [`${generic} is used for testing.`],
    ...extra,
  };
}

function okJsonResponse(results: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ meta: {}, results }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _clearLabelCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _clearLabelCache();
});

describe("openFDA client fallbacks (fetch stubbed)", () => {
  it("timeout / network failure -> bundled fixture fallback", async () => {
    fetchMock.mockRejectedValue(new Error("The operation was aborted due to timeout"));
    const r = await fetchLabel("warfarin");
    expect(r).not.toBeNull();
    expect(r!.dataSource).toBe(FALLBACK);
    expect(r!.label.name).toBe("warfarin");
  });

  it("non-200 response -> bundled fixture fallback", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const r = await fetchLabel("warfarin");
    expect(r).not.toBeNull();
    expect(r!.dataSource).toBe(FALLBACK);
  });

  it("malformed JSON body -> bundled fixture fallback", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });
    const r = await fetchLabel("warfarin");
    expect(r).not.toBeNull();
    expect(r!.dataSource).toBe(FALLBACK);
  });

  it("unknown drug with a failing network -> null (no label anywhere)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchLabel("nonexistentdrug-zzz")).toBeNull();
  });
});

describe("label cache (TTL + _clearLabelCache)", () => {
  it("serves repeats from cache, refetches after _clearLabelCache", async () => {
    fetchMock.mockResolvedValue(okJsonResponse([rawLabel("loratadine")]));
    const first = await fetchLabel("loratadine");
    const second = await fetchLabel("loratadine");
    expect(first!.dataSource).toBe(LIVE);
    expect(second!.dataSource).toBe(LIVE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    _clearLabelCache();
    const third = await fetchLabel("loratadine");
    expect(third!.dataSource).toBe(LIVE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("entries expire after the 1-hour TTL", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(okJsonResponse([rawLabel("loratadine")]));
      await fetchLabel("loratadine");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 59 * 60 * 1000);
      await fetchLabel("loratadine");
      expect(fetchMock).toHaveBeenCalledTimes(1); // still cached
      vi.setSystemTime(Date.now() + 2 * 60 * 1000); // now 61 minutes after first fetch
      await fetchLabel("loratadine");
      expect(fetchMock).toHaveBeenCalledTimes(2); // TTL expired -> refetch
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scoreCandidate + best-label selection", () => {
  const comboLabel = rawLabel("ibuprofen diphenhydramine citrate", {
    indications_and_usage: ["A sleep aid / pain reliever combo."],
  });
  const exactLabel = rawLabel("ibuprofen", {
    drug_interactions: ["Warfarin-type anticoagulants: bleeding has been reported. ".repeat(20)],
    boxed_warning: ["NSAIDs cause an increased risk of serious gastrointestinal events."],
  });

  it("scores the exact-generic, interactions-bearing label highest", () => {
    expect(scoreCandidate(exactLabel, "ibuprofen")).toBeGreaterThan(
      scoreCandidate(comboLabel, "ibuprofen"),
    );
  });

  it("fetchLabel picks that label out of a multi-label response", async () => {
    // Combo label listed FIRST — selection must be by score, not position.
    fetchMock.mockResolvedValue(okJsonResponse([comboLabel, exactLabel]));
    const r = await fetchLabel("ibuprofen");
    expect(r!.dataSource).toBe(LIVE);
    expect(r!.label.genericNames).toContain("ibuprofen");
    expect(r!.label.drugInteractions).toMatch(/Warfarin-type anticoagulants/);
  });
});

describe("query sanitisation (P1-4)", () => {
  it("strips Lucene syntax characters, keeps name characters", () => {
    // Input in production is the canonical name (already lowercased by
    // normalizeMedName), so the allowlist only needs a-z.
    expect(sanitizeQueryTerm('warfarin" or (bleeding)')).toBe("warfarin or bleeding");
    expect(sanitizeQueryTerm("children's motrin")).toBe("children's motrin");
    expect(sanitizeQueryTerm("a+b*c?d^e$f{g}h[i]j\\k|l~m:n")).toBe("abcdefghijklmn");
  });

  it("skips the live call entirely when nothing queryable survives", async () => {
    const r = await fetchLabel('""(){}[]^~*?:\\');
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
