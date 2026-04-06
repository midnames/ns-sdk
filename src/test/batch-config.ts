export interface DomainCosts {
  short: bigint;  // <=3 chars
  medium: bigint; // 4 chars
  long: bigint;   // 5+ chars
}

export interface DomainSettings {
  coinColor?: string;    // hex string (64 chars) — defaults to native token
  costs?: DomainCosts;   // defaults to { short: 100n, medium: 10n, long: 1n }
  buyEnabled?: boolean;  // defaults to true
}

export interface DomainEntry {
  domain: string; // e.g. "foo", "doc.foo", "sub.doc.foo"
  fields: [string, string][];
  settings?: DomainSettings; // per-domain overrides
}

export interface BatchDeployConfig {
  network: "preview" | "preprod" | "mainnet" | "standalone";
  tld?: string; // defaults to "night"
  contractAddress?: string; // join existing contract instead of deploying
  walletSeed?: string; // hex seed override
  defaults?: DomainSettings; // global defaults for all domains
  rootFields?: [string, string][]; // initial fields for root domain (max 10)
  deployCircuits?: string[]; // circuit IDs to include in initial deploy TX; remaining are inserted after via maintenance TXs (default: all — single deploy TX)
  domains: DomainEntry[];
}
