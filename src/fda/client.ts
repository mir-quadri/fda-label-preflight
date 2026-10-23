/**
 * openFDA client — live FDA drug-label lookup with an offline fallback.
 *
 * - Queries https://api.fda.gov/drug/label.json (no API key required) with a
 *   4-second timeout; a slow or unreachable API must never stall a safety
 *   check, so any failure falls back to the bundled label excerpts.
 * - Caches labels in memory for 1 hour (labels change rarely; the demo
 *   shouldn't hammer a public API).
 * - Picks the most useful label from the results: prefers a single-ingredient
 *   label whose generic name matches the query, and a label that actually
 *   has a drug_interactions section.
 * - Every result carries its provenance: "live openFDA" or "bundled label
 *   excerpt (offline fallback)" — callers must surface it, never hide it.
 */
import { LABEL_FIXTURES } from "./fixtures.js";
import { canonicalMedName, normalizeMedName } from "./names.js";
import type { LabelData, LabelResult } from "./types.js";

const OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json";
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Hard cap on cached labels; oldest entries are evicted beyond this. */
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  result: LabelResult;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function cacheSet(key: string, result: LabelResult): void {
  cache.delete(key); // refresh recency so eviction is least-recently-used
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Reduce a canonical med name to characters that are safe inside an openFDA
 * Lucene phrase query: letters, digits, spaces, hyphens, apostrophes. Quotes,
 * parentheses, colons, wildcards etc. are query syntax — a stray one would
 * corrupt the query (or worse, reshape it), so they never reach the API.
 */
export function sanitizeQueryTerm(canonical: string): string {
  return canonical
    .replace(/[^a-z0-9\s\-']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length ? t : undefined;
}

function fromOpenFda(raw: any, queryName: string): LabelData {
  const generic = (raw?.openfda?.generic_name ?? []).map((s: string) => s.toLowerCase());
  const brand = (raw?.openfda?.brand_name ?? []).map((s: string) => s.toLowerCase());
  return {
    name: canonicalMedName(generic[0] ?? queryName),
    brandNames: brand,
    genericNames: generic,
    boxedWarning: clean(raw?.boxed_warning?.[0]),
    indicationsAndUsage: clean(raw?.indications_and_usage?.[0]),
    drugInteractions: clean(raw?.drug_interactions?.[0]),
    warnings: clean(raw?.warnings?.[0] ?? raw?.warnings_and_cautions?.[0]),
    dosageAndAdministration: clean(raw?.dosage_and_administration?.[0]),
  };
}

/** Exported for tests: ranks candidate labels from a multi-label response. */
export function scoreCandidate(raw: any, queryCanonical: string): number {
  let score = 0;
  const generics = (raw?.openfda?.generic_name ?? []).map((g: string) => normalizeMedName(g));
  if (generics.some((g: string) => g === queryCanonical)) score += 4; // single-ingredient exact match
  const interactionsLen = (raw?.drug_interactions?.[0] ?? "").length;
  if (interactionsLen) score += 3 + Math.min(3, interactionsLen / 1500); // the fuller the interactions text, the more useful the label
  if (raw?.boxed_warning?.[0]) score += 1;
  if (raw?.indications_and_usage?.[0]) score += 1;
  return score;
}

function fixtureFor(name: string): LabelData | undefined {
  const canonical = canonicalMedName(name);
  if (LABEL_FIXTURES[canonical]) return LABEL_FIXTURES[canonical];
  // Also match a fixture by any of its brand/generic names.
  for (const fixture of Object.values(LABEL_FIXTURES)) {
    const names = [fixture.name, ...fixture.brandNames, ...fixture.genericNames].map((n) =>
      canonicalMedName(n),
    );
    if (names.includes(canonical)) return fixture;
  }
  return undefined;
}

/**
 * Look up a medication's FDA label by brand or generic name.
 * Returns null only when neither the live API nor the fixtures know it.
 */
export async function fetchLabel(name: string): Promise<LabelResult | null> {
  const canonical = canonicalMedName(name);
  const cached = cache.get(canonical);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let result: LabelResult | null = null;
  // Sanitise before the name goes anywhere near openFDA's Lucene query
  // syntax. If nothing queryable survives, skip the live call entirely —
  // an empty phrase query would be meaningless — and go straight to the
  // bundled-excerpt fallback.
  const queryTerm = sanitizeQueryTerm(canonical);
  if (queryTerm) {
    try {
      // `canonical` is already the generic name (brand aliases are resolved
      // by canonicalMedName), so a generic-name search is the right query.
      // Build it with URLSearchParams: openFDA's search syntax needs real
      // spaces (encoded as +), not percent-encoded plus signs.
      const params = new URLSearchParams({ search: `openfda.generic_name:"${queryTerm}"`, limit: "10" });
      const res = await fetch(`${OPENFDA_LABEL_URL}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data: any = await res.json();
        const results: any[] = data?.results ?? [];
        if (results.length) {
          const best = [...results].sort(
            (a, b) => scoreCandidate(b, canonical) - scoreCandidate(a, canonical),
          )[0];
          result = { label: fromOpenFda(best, name), dataSource: "live openFDA" };
        }
      }
    } catch (err) {
      // Live lookup is best-effort; the fallback below covers failure. Log it:
      // a silently-dead API would otherwise masquerade as "no label found".
      console.error("[openfda] live lookup failed, using fallback:", err instanceof Error ? err.message : err);
    }
  }

  if (!result) {
    const fixture = fixtureFor(name);
    if (fixture) result = { label: fixture, dataSource: "bundled label excerpt (offline fallback)" };
  }

  if (result) cacheSet(canonical, result);
  return result;
}

/** Test helper — clears the label cache. Not exposed as an MCP tool. */
export function _clearLabelCache(): void {
  cache.clear();
}
