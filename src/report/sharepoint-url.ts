const SHAREPOINT_HOST_SUFFIXES = [
  ".sharepoint.com",
  ".sharepoint.us",
  ".sharepoint.de",
  ".sharepoint.cn",
] as const;

export function sharePointSiteUrl(hostname: string, path: string): string | undefined {
  const normalizedHostname = hostname.trim().toLowerCase();
  const suffix = SHAREPOINT_HOST_SUFFIXES.find((candidate) =>
    normalizedHostname.endsWith(candidate)
  );
  const tenantLabel = suffix ? normalizedHostname.slice(0, -suffix.length) : "";
  if (!suffix || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenantLabel)) {
    return undefined;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;

  try {
    const url = new URL(`https://${normalizedHostname}${path}`);
    if (url.protocol !== "https:"
      || url.hostname !== normalizedHostname
      || url.username
      || url.password
      || url.port
      || url.search
      || url.hash
      || url.pathname !== path) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
