import type { BatchDeployConfig } from "./batch-config";
import { companyFields } from "./profile-fields";

/**
 * Preview-network test deployment.
 * Run: bun run src/test/batch-deploy.ts src/test/preview-deploy.config.ts
 *
 * Required env vars:
 *   SEED                 — wallet seed (hex or BIP39 mnemonic)
 *   MIDNIGHT_SECRET_KEY  — 32-byte hex secret key for domain ownership
 *   EXPORT_PASSWORD      — (optional) password for encrypting the backup export
 */
export const config: BatchDeployConfig = {
  network: "preview",
  tld: "night",
  defaults: {
    coinColor: "0000000000000000000000000000000000000000000000000000000000000000",
    costs: { short: 600n, medium: 140n, long: 10n },
    buyEnabled: true,
  },
  deployCircuits: [], // partial deploy: insert all VKs via maintenance TXs
  rootFields: [
    ["name", "Midnight Domains"],
    ["bio", "Domain Name Service for Midnight Network"],
  ],
  domains: [
    {
      domain: "mid",
      fields: companyFields({
        name: "Midnight",
        avatar:
          "https://midnight.network/_next/image?url=https%3A%2F%2Fcdn.sanity.io%2Fimages%2F330xhmya%2Fproduction%2Fad443f6fdbb0ae48712b1729b6a0a61be245577f-829x832.png&w=1920&q=75",
      }),
      settings: {
        buyEnabled: false,
      },
    },
  ],
};
