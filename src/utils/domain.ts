export const DEFAULT_TLD = "night";

export function normalizeDomain(input: string, assumeTld: boolean = true): string {
  const cleaned = input.trim().toLowerCase().replace(/\.+/g, ".").replace(/\.$/, "");
  if (!assumeTld) return cleaned;
  if (cleaned === DEFAULT_TLD) return cleaned;
  if (cleaned.endsWith(`.${DEFAULT_TLD}`)) return cleaned;
  return `${cleaned}.${DEFAULT_TLD}`;
}

export interface ParsedDomain {
  isValid: boolean;
  domainName: string;
  parentDomainPath: string;
  fullDomain: string;
  depth: number;
}

export function parseFullDomain(fullDomain: string, tld: string = DEFAULT_TLD): ParsedDomain {
  const normalized = normalizeDomain(fullDomain);
  const parts = normalized.split(".");
  if (parts[parts.length - 1] !== tld || parts.length < 2) {
    return { isValid: false, domainName: "", parentDomainPath: "", fullDomain: normalized, depth: 0 };
  }
  return {
    isValid: true,
    domainName: parts[0],
    parentDomainPath: parts.slice(1).join("."),
    fullDomain: normalized,
    depth: parts.length - 1,
  };
}

export function isValidDomainName(domainName: string): boolean {
  if (!domainName || domainName.length === 0 || domainName.length > 32) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(domainName.toLowerCase());
}

export function isTLD(domain: string, tld: string = DEFAULT_TLD): boolean {
  return normalizeDomain(domain, false) === tld;
}

export function domainToKey(name: string): { key: Uint8Array; len: bigint } {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length === 0 || bytes.length > 32)
    throw new Error(`Domain name must be 1-32 bytes, got ${bytes.length}`);
  const key = new Uint8Array(32).fill(255);
  key.set(bytes);
  return { key, len: BigInt(bytes.length) };
}

export function keyToDomain(key: Uint8Array): string {
  let len = 32;
  for (let i = 0; i < 32; i++) {
    if (key[i] === 255) { len = i; break; }
  }
  return new TextDecoder().decode(key.subarray(0, len));
}
