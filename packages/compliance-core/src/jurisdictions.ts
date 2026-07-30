type SupportedCategory = "online_game" | "electronic_press" | "digital_entertainment";

export type JurisdictionCode = "VN";

export interface JurisdictionSpec {
  readonly code: JurisdictionCode;
  readonly enabled: boolean;
  readonly sourceHosts: readonly string[];
  readonly reportLocales: readonly string[];
  readonly defaultLocale: string;
  readonly ruleset: readonly SupportedCategory[];
  readonly label: string;
}

export const jurisdictions: readonly JurisdictionSpec[] = [
  {
    code: "VN",
    enabled: true,
    sourceHosts: ["vbpl.vn"],
    reportLocales: ["vi", "en"],
    defaultLocale: "vi",
    ruleset: ["online_game", "electronic_press", "digital_entertainment"],
    label: "Việt Nam",
  },
] as const;

export const findJurisdiction = (
  code: string,
): JurisdictionSpec | undefined => jurisdictions.find((entry) => entry.code === code);

export const isEnabledJurisdiction = (code: string): boolean => {
  const spec = findJurisdiction(code);
  return Boolean(spec?.enabled);
};

export const supportsCategory = (
  jurisdiction: string,
  category: SupportedCategory,
): boolean => {
  const spec = findJurisdiction(jurisdiction);
  if (!spec) return false;
  return spec.ruleset.includes(category);
};

export const defaultLocaleFor = (jurisdiction: string): string =>
  findJurisdiction(jurisdiction)?.defaultLocale ?? "vi";
