/**
 * Hosts whose URLs we trust to display as "Xem văn bản đầy đủ" links.
 *
 * Source of truth for Vietnam legal citations: vbpl.vn (Cơ sở dữ liệu quốc
 * gia về pháp luật). Secondary public mirrors: hoidapphapluat.vn,
 * thuvienphapluat.vn. Mirroring the allow-list already present in
 * apps/workers/src/services/url-policy.ts and
 * packages/compliance-core/src/jurisdictions.ts.
 *
 * Keep this list small and conservative — adding a host here means we
 * guarantee the URL will not 404 the user. Any new host must be verified
 * to return a 200 on a sample legal-provision query before being added.
 */
export const APPROVED_CITATION_HOSTS = [
  "vbpl.vn",
  "hoidapphapluat.vn",
  "thuvienphapluat.vn",
] as const;

export type ApprovedCitationHost = (typeof APPROVED_CITATION_HOSTS)[number];

export const isApprovedCitationUrl = (url: string): boolean => {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return APPROVED_CITATION_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
};
