import type { BatchDeployConfig } from "./batch-config";
import { companyFields } from "./profile-fields";

/**
 * Example config for the single-contract batch deploy.
 * Run: bun run src/test/batch-deploy.ts src/test/example-deploy.config.ts
 *
 * Required env vars:
 *   SEED                 — wallet seed (hex or BIP39 mnemonic)
 *   MIDNIGHT_SECRET_KEY  — 32-byte hex secret key for domain ownership
 *   EXPORT_PASSWORD      — (optional) password for encrypting the backup export
 */
export const config: BatchDeployConfig = {
  network: "preprod",
  tld: "night",
  defaults: {
    coinColor: "0000000000000000000000000000000000000000000000000000000000000000",
    costs: { short: 50n, medium: 10n, long: 5n },
    buyEnabled: true,
  },
  rootFields: [
    ["name", "Midnames"],
    ["bio", "Midnight Name Service"],
  ],
  domains: [
    {
      domain: "mid",
      fields: companyFields({
        name: "Midnight",
        avatar: "https://midnight.network/_next/image?url=https%3A%2F%2Fcdn.sanity.io%2Fimages%2F330xhmya%2Fproduction%2Fad443f6fdbb0ae48712b1729b6a0a61be245577f-829x832.png&w=1920&q=75",
      }),
      settings: {
        buyEnabled: false,
      },
    },
  ],
};
