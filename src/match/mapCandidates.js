export function mapDbRowsToCandidates(rows = []) {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    region: r.region || "",
    industry: r.industry || "",
    period: r.period || r.aplyPd || "",
    conditions: Array.isArray(r.conditions)
      ? r.conditions
      : r.conditions
      ? String(r.conditions)
          .split(/[;,/、，|]|\s{2,}/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    url:
      r.url ||
      (r.pbancId ? `https://www.sbiz24.kr/#/extldPbanc/${r.pbancId}` : null),
  }));
}
