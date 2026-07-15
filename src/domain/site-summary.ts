import type {
  ScanStatus,
  SensitivityInventoryItem,
  SiteSensitivitySummary,
} from "./types";
import { stableFileKey } from "./types";

const STATUS_VALUES: ScanStatus[] = [
  "success",
  "no-label",
  "unsupported",
  "locked",
  "throttled",
  "failed",
];

export function buildSiteSensitivitySummary(input: {
  tenantId: string;
  siteId: string;
  siteName: string;
  siteWebUrl?: string;
  items: SensitivityInventoryItem[];
  reportableLabelIds: ReadonlySet<string>;
  updatedAt: string;
  latestRunId?: string;
}): SiteSensitivitySummary {
  const current = [...new Map(
    input.items
      .filter((item) => !item.deletedAt)
      .map((item) => {
        if (item.tenantId !== input.tenantId || item.siteId !== input.siteId) {
          throw new Error("Refusing to summarize inventory outside the requested tenant and Site");
        }
        return [stableFileKey(item), item];
      }),
  ).values()];
  const sensitive = current.filter((item) => item.sensitivityLabels.some(
    (label) => input.reportableLabelIds.has(label.id),
  ));
  const labelCounts = new Map<string, { id: string; displayName?: string; keys: Set<string> }>();
  const libraryCounts = new Map<string, Set<string>>();

  for (const item of sensitive) {
    const key = stableFileKey(item);
    const library = libraryCounts.get(item.libraryName) ?? new Set<string>();
    library.add(key);
    libraryCounts.set(item.libraryName, library);
    for (const label of item.sensitivityLabels) {
      if (!input.reportableLabelIds.has(label.id)) continue;
      const count = labelCounts.get(label.id) ?? {
        id: label.id,
        displayName: label.displayName,
        keys: new Set<string>(),
      };
      count.keys.add(key);
      if (!count.displayName && label.displayName) count.displayName = label.displayName;
      labelCounts.set(label.id, count);
    }
  }

  return {
    tenantId: input.tenantId,
    siteId: input.siteId,
    siteName: input.siteName,
    siteWebUrl: input.siteWebUrl,
    inventoryCount: current.length,
    sensitiveCount: sensitive.length,
    libraryCount: new Set(current.map((item) => item.libraryName)).size,
    labelCounts: [...labelCounts.values()]
      .map(({ keys, ...label }) => ({ ...label, count: keys.size }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    libraryCounts: [...libraryCounts]
      .map(([libraryName, keys]) => ({ libraryName, sensitiveCount: keys.size }))
      .sort((a, b) => a.libraryName.localeCompare(b.libraryName)),
    statusCounts: Object.fromEntries(STATUS_VALUES.map((status) => [
      status,
      current.filter((item) => item.scanStatus === status).length,
    ])) as Record<ScanStatus, number>,
    lastScannedAt: current.map((item) => item.scannedAt).sort((a, b) => b.localeCompare(a))[0],
    latestRunId: input.latestRunId,
    updatedAt: input.updatedAt,
  };
}
