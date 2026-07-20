import type { EntraAuthConfig } from "./entra-config";

export const ENTRA_SESSION_COOKIE = "sp-sens-entra-session";
export const ENTRA_FLOW_COOKIE = "sp-sens-entra-flow";
export const ENTRA_GRAPH_COOKIE = "sp-sens-entra-graph";

type ExpiringPayload = { expiresAt: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid protected cookie encoding");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(config: EntraAuthConfig) {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(config.sessionSecret).buffer,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealProtectedCookie<T extends ExpiringPayload>(
  payload: T,
  config: EntraAuthConfig,
  purpose: "flow" | "session" | "graph",
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: encoder.encode(`sharepoint-sensitivity-report:${purpose}:v1`),
  }, await encryptionKey(config), encoder.encode(JSON.stringify(payload))));
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv);
  combined.set(ciphertext, iv.byteLength);
  return encodeBase64Url(combined);
}

export async function openProtectedCookie<T extends ExpiringPayload>(
  value: string,
  config: EntraAuthConfig,
  purpose: "flow" | "session" | "graph",
  now = Date.now(),
): Promise<T> {
  try {
    const combined = decodeBase64Url(value);
    if (combined.byteLength < 29) throw new Error("Protected cookie is too short");
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: combined.slice(0, 12),
      additionalData: encoder.encode(`sharepoint-sensitivity-report:${purpose}:v1`),
    }, await encryptionKey(config), combined.slice(12));
    const payload = JSON.parse(decoder.decode(plaintext)) as T;
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
      throw new Error("Protected cookie has expired");
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && /expired/.test(error.message)) throw error;
    throw new Error("Protected cookie is invalid");
  }
}

export function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  input: { maxAge: number; secure: boolean },
) {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    input.secure ? "Secure" : "",
    `Max-Age=${Math.max(Math.floor(input.maxAge), 0)}`,
  ].filter(Boolean).join("; ");
}

export function clearCookie(name: string, secure: boolean) {
  return serializeCookie(name, "", { maxAge: 0, secure });
}
