export type EntraSecurityGroup = {
  id: string;
  displayName: string;
  mail?: string;
};

export class EntraGroupSearchError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = "EntraGroupSearchError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeQuery(value: string) {
  const query = value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 80) {
    throw new EntraGroupSearchError("Group search must contain 2 to 80 characters", 400);
  }
  return query;
}

export async function searchEntraSecurityGroups(
  query: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EntraSecurityGroup[]> {
  const normalizedQuery = normalizeQuery(query);
  if (!accessToken.trim()) throw new EntraGroupSearchError("Graph access token is missing", 401);
  const url = new URL("https://graph.microsoft.com/v1.0/groups");
  url.searchParams.set("$search", `\"displayName:${normalizedQuery}\"`);
  url.searchParams.set("$select", "id,displayName,mail,securityEnabled");
  url.searchParams.set("$count", "true");
  url.searchParams.set("$top", "20");
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: "eventual",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new EntraGroupSearchError("Microsoft Graph redirects are not allowed");
  }
  if (response.status === 401 || response.status === 403) {
    throw new EntraGroupSearchError("Microsoft Graph consent or session is unavailable", response.status);
  }
  if (!response.ok) throw new EntraGroupSearchError(`Microsoft Graph returned HTTP ${response.status}`);
  const body = await response.json() as { value?: unknown[] };
  if (!Array.isArray(body.value)) throw new EntraGroupSearchError("Microsoft Graph returned an invalid response");
  return body.value.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const group = value as Record<string, unknown>;
    const id = typeof group.id === "string" ? group.id.toLocaleLowerCase() : "";
    const displayName = typeof group.displayName === "string" ? group.displayName.trim() : "";
    if (!UUID_PATTERN.test(id) || !displayName || group.securityEnabled !== true) return [];
    return [{
      id,
      displayName: displayName.slice(0, 256),
      mail: typeof group.mail === "string" && group.mail ? group.mail.slice(0, 320) : undefined,
    }];
  });
}
