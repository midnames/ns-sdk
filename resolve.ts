#!/usr/bin/env bun
/**
 * Single-contract Midnames resolver — CLI + HTTP server in one file.
 *
 * Usage:
 *   TLD=<contract_address> bun run resolve something.night
 *   TLD=<contract_address> bun run resolve something.night/twitter
 *   TLD=<contract_address> bun run resolve something.night --json
 *   TLD=<contract_address> bun run resolve something.night --network preprod
 *   TLD=<contract_address> bun run resolve --serve [--port 3000]
 */

import {
  getDefaultProvider,
  resolveDefault,
  getDomainFields,
  getDomainProfile,
  getDomainInfo,
} from "./src/index.js";
import type { DomainTarget } from "./src/index.js";
import {
  MidnightBech32m,
  ShieldedCoinPublicKey,
  ShieldedAddress,
  ShieldedEncryptionPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

// ─── Config ─────────────────────────────────────────────────────────────────
const contractAddress = process.env.TLD;
if (!contractAddress) {
  console.error("TLD env variable is required (contract address).\n");
  console.error("Usage: TLD=<contract_address> bun run resolve <domain>[/field] [--network preprod] [--json] [--serve]");
  process.exit(1);
}

// ─── EPK derivation ─────────────────────────────────────────────────────────
function deriveShieldedAddress(coinPublicKeyAddress: string, encryptionPublicKey: string): string | null {
  try {
    const cpkParsed = MidnightBech32m.parse(coinPublicKeyAddress);
    if (cpkParsed.type !== "shield-cpk") return null;
    const coinPublicKey = ShieldedCoinPublicKey.codec.decode(getNetworkId(), cpkParsed);
    const epkParsed = MidnightBech32m.parse(encryptionPublicKey);
    if (epkParsed.type !== "shield-epk") return null;
    const encPubKey = ShieldedEncryptionPublicKey.codec.decode(getNetworkId(), epkParsed);
    const shieldedAddress = new ShieldedAddress(coinPublicKey, encPubKey);
    return ShieldedAddress.codec.encode(getNetworkId() as any, shieldedAddress).asString();
  } catch {
    return null;
  }
}

async function applyEpkDerivation(
  target: DomainTarget,
  fields: Map<string, string>,
): Promise<{ address: string; rawCoinPublicKey?: string }> {
  if (target.type === "shielded") {
    const epk = fields.get("epk");
    if (epk) {
      const derived = deriveShieldedAddress(target.address, epk);
      if (derived) return { address: derived, rawCoinPublicKey: target.address };
    }
  }
  return { address: target.address };
}

// ─── Parse args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let network = process.env.NETWORK || "preprod";
let json = false;
let serve = false;
let port = parseInt(process.env.PORT || "3000", 10);
let input: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--network" && args[i + 1]) {
    network = args[i + 1];
    i++;
  } else if (args[i] === "--json") {
    json = true;
  } else if (args[i] === "--serve") {
    serve = true;
  } else if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (!args[i].startsWith("--")) {
    input = args[i];
  }
}

const provider = getDefaultProvider(network);
const opts = { provider, contractAddress };

// ─── Server mode ────────────────────────────────────────────────────────────
if (serve) {
  function jsonResp(data: unknown, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  function errorResp(message: string, status = 404) {
    return jsonResp({ error: message }, status);
  }

  async function handleResolve(domain: string) {
    const result = await resolveDefault(domain, opts);
    if (!result.success) return errorResp(result.error.message);

    if (typeof result.data === "string") {
      return jsonResp({ domain, resolved: result.data });
    }

    const fieldsResult = await getDomainFields(domain, opts);
    const fields = fieldsResult.success ? fieldsResult.data : new Map<string, string>();
    const { address, rawCoinPublicKey } = await applyEpkDerivation(result.data, fields);

    return jsonResp({
      domain,
      resolved: address,
      type: result.data.type,
      ...(rawCoinPublicKey ? { rawCoinPublicKey } : {}),
    });
  }

  async function handleField(domain: string, field: string) {
    const fieldsResult = await getDomainFields(domain, opts);
    if (!fieldsResult.success) return errorResp(fieldsResult.error.message);

    const value = fieldsResult.data.get(field);
    if (value === undefined) return errorResp(`Field "${field}" not found on ${domain}`);

    return jsonResp({ domain, field, value });
  }

  async function handleProfile(domain: string) {
    const profileResult = await getDomainProfile(domain, opts);
    if (!profileResult.success) return errorResp(profileResult.error.message);

    const { info, fields, settings } = profileResult.data;

    let target: Record<string, string> | null = null;
    if (info?.target) {
      const { address, rawCoinPublicKey } = await applyEpkDerivation(info.target, fields);
      target = {
        type: info.target.type,
        address,
        ...(rawCoinPublicKey ? { rawCoinPublicKey } : {}),
      };
    }

    return jsonResp({
      domain,
      target,
      id: info?.id?.toString() ?? null,
      owner: info?.owner ?? null,
      ownerAddress: info?.ownerAddress ?? null,
      fields: Object.fromEntries(fields),
      settings: settings
        ? {
            buyEnabled: settings.buyEnabled,
            defaultField: settings.defaultField,
            costs: {
              short: settings.costs.short.toString(),
              medium: settings.costs.medium.toString(),
              long: settings.costs.long.toString(),
            },
          }
        : null,
    });
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.slice(1);

      if (!path) {
        return jsonResp({
          service: "midnames-resolver",
          network,
          contract: contractAddress,
          usage: {
            resolve: "GET /{domain}.night",
            field: "GET /{domain}.night/{field}",
            profile: "GET /{domain}.night?profile",
          },
        });
      }

      const firstSlash = path.indexOf("/");
      const domain = firstSlash === -1 ? path : path.substring(0, firstSlash);
      const field = firstSlash === -1 ? null : path.substring(firstSlash + 1);

      if (!domain.endsWith(".night")) {
        return errorResp("Domain must end with .night", 400);
      }

      if (url.searchParams.has("profile")) return handleProfile(domain);
      if (field) return handleField(domain, field);
      return handleResolve(domain);
    },
  });

  console.log(`Midnames resolver listening on port ${server.port} (network: ${network}, contract: ${contractAddress})`);
}

// ─── CLI mode ───────────────────────────────────────────────────────────────
else {
  if (!input) {
    console.error("Usage: TLD=<contract_address> bun run resolve <domain>[/field] [--network preprod] [--json]");
    console.error("       TLD=<contract_address> bun run resolve --serve [--port 3000]");
    process.exit(1);
  }

  const slashIndex = input.indexOf("/");
  const rawDomain = slashIndex === -1 ? input : input.substring(0, slashIndex);
  const fieldPath = slashIndex === -1 ? null : input.substring(slashIndex + 1);

  if (json) {
    // Full profile JSON
    const profileResult = await getDomainProfile(rawDomain, opts);
    if (!profileResult.success) {
      console.error(`Error: ${profileResult.error.message}`);
      process.exit(1);
    }
    const { info, fields, settings } = profileResult.data;

    let targetOutput: Record<string, string> | null = null;
    if (info?.target) {
      const { address, rawCoinPublicKey } = await applyEpkDerivation(info.target, fields);
      targetOutput = {
        type: info.target.type,
        address,
        ...(rawCoinPublicKey ? { rawCoinPublicKey } : {}),
      };
    }

    console.log(JSON.stringify({
      domain: rawDomain,
      target: targetOutput,
      id: info?.id?.toString() ?? null,
      owner: info?.owner ?? null,
      ownerAddress: info?.ownerAddress ?? null,
      fields: Object.fromEntries(fields),
      settings: settings
        ? {
            buyEnabled: settings.buyEnabled,
            defaultField: settings.defaultField,
            costs: {
              short: settings.costs.short.toString(),
              medium: settings.costs.medium.toString(),
              long: settings.costs.long.toString(),
            },
          }
        : null,
    }, null, 2));
  } else if (fieldPath) {
    // Field lookup: something.night/twitter
    const fieldsResult = await getDomainFields(rawDomain, opts);
    if (!fieldsResult.success) {
      console.error(`Error: ${fieldsResult.error.message}`);
      process.exit(1);
    }
    const value = fieldsResult.data.get(fieldPath);
    if (value === undefined) {
      console.error(`Field "${fieldPath}" not found on ${rawDomain}`);
      process.exit(1);
    }
    console.log(value);
  } else {
    // Default resolution
    const result = await resolveDefault(rawDomain, opts);
    if (!result.success) {
      console.error(`Error: ${result.error.message}`);
      process.exit(1);
    }

    if (typeof result.data === "string") {
      console.log(result.data);
    } else {
      const fieldsResult = await getDomainFields(rawDomain, opts);
      const fields = fieldsResult.success ? fieldsResult.data : new Map<string, string>();
      const { address } = await applyEpkDerivation(result.data, fields);
      console.log(address);
    }
  }
}
