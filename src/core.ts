import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { ShieldedCoinPublicKey } from "@midnight-ntwrk/wallet-sdk-address-format";
// Imported rather than taken from the global scope so the SDK works in browsers,
// where `Buffer` is not defined. Node resolves this to its built-in module.
import { Buffer } from "buffer";
import { ledger, AddressType } from "./contract.js";
import type { Ledger } from "./managed/contract/index.js";
import { formatContractAddress, bytesToHex, formatUnshieldedAddress } from "./utils/address.js";
import { normalizeDomain, parseFullDomain, DEFAULT_TLD, isTLD, domainToKey, keyToDomain } from "./utils/domain.js";
import type { DomainInfo, DomainSettings, DomainProfileData, DomainTarget } from "./types.js";
import { type Result, success, failure, wrapAsync } from "./results.js";
import {
  NetworkError,
  ContractNotFoundError,
  DomainNotFoundError,
  InvalidDomainError,
} from "./errors.js";
import { getDefaultProvider, getNetworkConfig } from "./provider.js";

function getDefaultContractAddress(): string {
  const currentNetwork = getNetworkId();
  return getNetworkConfig(currentNetwork).contractAddress;
}

export function getTargetFromDomainData(data: {
  target: Uint8Array;
  target_type: AddressType;
}): DomainTarget {
  switch (data.target_type) {
    case AddressType.ContractAddr:
      return { type: "contract", address: formatContractAddress(data.target) };
    case AddressType.ZswapCPKAddr: {
      const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(data.target));
      const address = ShieldedCoinPublicKey.codec.encode(
        getNetworkId() as any,
        coinPublicKey,
      ).asString();
      return { type: "shielded", address };
    }
    case AddressType.UnshieldedAddr:
      return { type: "unshielded", address: bytesToHex(data.target) };
  }
}

export async function queryContractState(
  publicDataProvider: PublicDataProvider,
  contractAddress: string,
): Promise<Result<any>> {
  return wrapAsync(async () => {
    const contractState =
      await publicDataProvider.queryContractState(contractAddress);
    if (contractState == null) {
      throw new ContractNotFoundError(contractAddress);
    }
    return contractState;
  });
}

export async function getContractLedger(
  publicDataProvider: PublicDataProvider,
  contractAddress?: string,
): Promise<Result<Ledger>> {
  const addr = contractAddress ?? getDefaultContractAddress();
  const stateResult = await queryContractState(publicDataProvider, addr);
  if (!stateResult.success) return failure(stateResult.error);
  return success(ledger(stateResult.data.data));
}

/**
 * Resolve a full domain string (e.g. "sub.example.night") to its numeric ID
 * within the contract ledger. Returns null if any part of the path is not found.
 */
export function resolveDomainIdInLedger(
  contractLedger: Ledger,
  fullDomain: string,
): bigint | null {
  const parts = fullDomain.split(".");
  // Remove TLD, reverse to walk from root
  const traversalParts = parts.slice(0, -1).reverse();

  if (traversalParts.length === 0) {
    return contractLedger.ROOT_ZONE_ID;
  }

  let parentId = contractLedger.ROOT_ZONE_ID;

  for (const part of traversalParts) {
    const ref = { domain: domainToKey(part).key, parent_id: parentId };
    if (!contractLedger.name_to_id.member(ref)) return null;
    parentId = contractLedger.name_to_id.lookup(ref);
  }

  return parentId;
}

// ---- Public read functions ----

export async function resolveDomain(
  domain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<DomainTarget>> {
  const normalized = normalizeDomain(domain);
  if (!normalized.endsWith(`.${DEFAULT_TLD}`)) {
    return failure(new InvalidDomainError(domain, "Domain must end with .night"));
  }

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const domainId = resolveDomainIdInLedger(contractLedger, normalized);
    if (domainId === null) throw new DomainNotFoundError(normalized);

    const domainData = contractLedger.id_to_data.lookup(domainId);
    return getTargetFromDomainData(domainData);
  });
}

export async function resolveDefault(
  domain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<string | DomainTarget>> {
  const normalized = normalizeDomain(domain);
  if (!normalized.endsWith(`.${DEFAULT_TLD}`)) {
    return failure(new InvalidDomainError(domain, "Domain must end with .night"));
  }

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const domainId = resolveDomainIdInLedger(contractLedger, normalized);
    if (domainId === null) throw new DomainNotFoundError(normalized);

    const domainData = contractLedger.id_to_data.lookup(domainId);

    // If there's a default field set, try to return its value
    if (domainData.default_field.is_some) {
      const fieldKey = domainData.default_field.value;
      if (
        contractLedger.domain_fields.member(domainId) &&
        contractLedger.domain_fields.lookup(domainId).member(fieldKey)
      ) {
        return contractLedger.domain_fields.lookup(domainId).lookup(fieldKey);
      }
    }

    return getTargetFromDomainData(domainData);
  });
}

export async function getDomainInfo(
  fullDomain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<DomainInfo>> {
  const normalized = normalizeDomain(fullDomain);
  if (!isTLD(normalized)) {
    const parsed = parseFullDomain(normalized);
    if (!parsed.isValid) {
      return failure(new InvalidDomainError(fullDomain, "Invalid domain format"));
    }
  }

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const domainId = resolveDomainIdInLedger(contractLedger, normalized);
    if (domainId === null) throw new DomainNotFoundError(normalized);

    const domainData = contractLedger.id_to_data.lookup(domainId);
    return {
      id: domainId,
      owner: bytesToHex(domainData.owner_public_key),
      ownerAddress: formatUnshieldedAddress(domainData.owner_address.bytes),
      target: getTargetFromDomainData(domainData),
      targetLocked: domainData.target_locked,
    };
  });
}

export async function getDomainFields(
  fullDomain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<Map<string, string>>> {
  const normalized = normalizeDomain(fullDomain);

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const domainId = resolveDomainIdInLedger(contractLedger, normalized);
    if (domainId === null) throw new DomainNotFoundError(normalized);

    const fields: Map<string, string> = new Map();
    if (contractLedger.domain_fields.member(domainId)) {
      for (const [key, value] of contractLedger.domain_fields.lookup(domainId)) {
        fields.set(key, value);
      }
    }
    return fields;
  });
}

export async function getDomainSettings(
  fullDomain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<DomainSettings>> {
  const normalized = normalizeDomain(fullDomain);

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const domainId = resolveDomainIdInLedger(contractLedger, normalized);
    if (domainId === null) throw new DomainNotFoundError(normalized);

    const data = contractLedger.id_to_data.lookup(domainId);
    return {
      coinColor: data.payment_config.coin_color,
      costs: {
        short: data.payment_config.cost_short,
        medium: data.payment_config.cost_med,
        long: data.payment_config.cost_long,
      },
      buyEnabled: data.payment_config.buy_enabled,
      defaultField: data.default_field.is_some ? data.default_field.value : null,
      paymentConfigLocked: data.payment_config_locked,
    };
  });
}

export async function getDomainProfile(
  fullDomain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<DomainProfileData>> {
  const normalized = normalizeDomain(fullDomain);

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const domainId = resolveDomainIdInLedger(contractLedger, normalized);
    if (domainId === null) throw new DomainNotFoundError(normalized);

    const domainData = contractLedger.id_to_data.lookup(domainId);

    const info: DomainInfo = {
      id: domainId,
      owner: bytesToHex(domainData.owner_public_key),
      ownerAddress: formatUnshieldedAddress(domainData.owner_address.bytes),
      target: getTargetFromDomainData(domainData),
      targetLocked: domainData.target_locked,
    };

    const fields: Map<string, string> = new Map();
    if (contractLedger.domain_fields.member(domainId)) {
      for (const [key, value] of contractLedger.domain_fields.lookup(domainId)) {
        fields.set(key, value);
      }
    }

    const settings: DomainSettings = {
      coinColor: domainData.payment_config.coin_color,
      costs: {
        short: domainData.payment_config.cost_short,
        medium: domainData.payment_config.cost_med,
        long: domainData.payment_config.cost_long,
      },
      buyEnabled: domainData.payment_config.buy_enabled,
      defaultField: domainData.default_field.is_some
        ? domainData.default_field.value
        : null,
      paymentConfigLocked: domainData.payment_config_locked,
    };

    return { fullDomain: normalized, info, fields, settings };
  });
}

export async function getSubdomains(
  fullDomain: string,
  options: { provider?: PublicDataProvider; contractAddress?: string } = {},
): Promise<Result<Map<string, DomainInfo>>> {
  const normalized = normalizeDomain(fullDomain);

  return wrapAsync(async () => {
    const provider = options.provider || getDefaultProvider();
    const ledgerResult = await getContractLedger(provider, options.contractAddress);
    if (!ledgerResult.success) throw ledgerResult.error;

    const contractLedger = ledgerResult.data;
    const parentId = resolveDomainIdInLedger(contractLedger, normalized);
    if (parentId === null) throw new DomainNotFoundError(normalized);

    const subdomains: Map<string, DomainInfo> = new Map();
    for (const [ref, id] of contractLedger.name_to_id) {
      if (ref.parent_id === parentId) {
        const data = contractLedger.id_to_data.lookup(id);
        subdomains.set(keyToDomain(ref.domain), {
          id,
          owner: bytesToHex(data.owner_public_key),
          ownerAddress: bytesToHex(data.owner_address.bytes),
          target: getTargetFromDomainData(data),
          targetLocked: data.target_locked,
        });
      }
    }
    return subdomains;
  });
}
