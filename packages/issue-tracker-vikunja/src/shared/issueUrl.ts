import { IssueTrackerKind } from "@t3tools/contracts";

export const VIKUNJA_KIND = IssueTrackerKind.make("vikunja");
export const VIKUNJA_DEFAULT_HOST = "vikunja.io";

/**
 * Normalizes a self-hosted Vikunja instance URL (e.g. `https://vikunja.example.com`,
 * `https://vikunja.example.com/api/v1`, or `http://localhost:3456/`) into a clean origin + optional
 * base path without a trailing slash.
 */
export function normalizeVikunjaBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const pathname = parsed.pathname
    .replace(/\/+$/u, "")
    .replace(/\/api\/v1$/iu, "")
    .replace(/\/+$/u, "");
  return `${parsed.origin.toLowerCase()}${pathname}`;
}

export function vikunjaHostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return VIKUNJA_DEFAULT_HOST;
  }
}

export function vikunjaTaskUrl(baseUrl: string, taskId: number): string {
  const normalized = normalizeVikunjaBaseUrl(baseUrl) ?? baseUrl.replace(/\/+$/u, "");
  return `${normalized}/tasks/${taskId}`;
}

/**
 * Parses a Vikunja task URL: `<baseUrl>/tasks/<id>`.
 * When `baseUrl` is supplied, the URL must match its origin and base path prefix so links to
 * unrelated hosts are never claimed as Vikunja issues.
 */
export function parseVikunjaIssueUrl(url: URL, baseUrl?: string) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const normalizedBase = baseUrl === undefined ? null : normalizeVikunjaBaseUrl(baseUrl);
  if (baseUrl !== undefined && normalizedBase === null) return null;

  let relativePath = url.pathname;
  let host = url.host.toLowerCase();
  let workspace = url.origin.toLowerCase();

  if (normalizedBase !== null) {
    const base = new URL(normalizedBase);
    if (url.origin.toLowerCase() !== base.origin.toLowerCase()) return null;
    const basePath = base.pathname.replace(/\/+$/u, "");
    if (basePath.length > 0) {
      if (!url.pathname.startsWith(`${basePath}/`)) return null;
      relativePath = url.pathname.slice(basePath.length);
    }
    host = base.host.toLowerCase();
    workspace = normalizedBase;
  }

  const match = /^\/tasks\/([1-9]\d*)(?:\/|$)/u.exec(relativePath);
  if (match === null) return null;
  const key = match[1]!;
  return { host, workspace, scope: "", key };
}
