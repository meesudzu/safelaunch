/**
 * Hosts whose URLs we trust to display as "Xem văn bản đầy đủ" links.
 *
 * Single source of truth for Vietnam legal citations: vbpl.vn (Cơ sở dữ liệu
 * quốc gia về pháp luật). Must stay aligned with the Vietnam entry in
 * `packages/compliance-core/src/jurisdictions.ts` (`sourceHosts`).
 *
 * Keep this list small and conservative — adding a host here means we
 * guarantee the URL will not 404 the user. Any new host must be verified
 * to return a 200 on a sample legal-provision query before being added.
 *
 * Secondary public mirrors (hoidapphapluat.vn, thuvienphapluat.vn) are
 * intentionally NOT whitelisted: every rendered citation must point to the
 * canonical vbpl.vn corpus so users always land on the authoritative source.
 */
export const APPROVED_CITATION_HOSTS = ["vbpl.vn"] as const;

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
