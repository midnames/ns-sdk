const ALLOWED_PROTOCOLS = /^(https?:\/\/|ipfs:\/\/|data:image\/)/i;

/**
 * Sanitizes a URL to prevent javascript: and other dangerous protocols.
 * Returns empty string for disallowed protocols.
 * Decodes URL-encoded characters before checking to prevent bypasses like java%73cript:
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  if (decoded.startsWith('/') || decoded.startsWith('./')) return trimmed;
  if (ALLOWED_PROTOCOLS.test(decoded)) return trimmed;
  return '';
}
