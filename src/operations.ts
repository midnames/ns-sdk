import { CompiledContract } from "@midnight-ntwrk/compact-js";
import {
  findDeployedContract,
  type ContractProviders,
} from "@midnight-ntwrk/midnight-js-contracts";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NS, MANAGED_DIR, witnesses, AddressType } from "./contract.js";
import type { DomainTarget } from "./types.js";
import type { DomainData } from "./managed/contract/index.js";
import { type Result, success, failure } from "./results.js";
import { NetworkError } from "./errors.js";
import { domainToKey } from "./utils/domain.js";
import { parseAddressToBytes } from "./utils/address.js";
import { getNetworkConfig } from "./provider.js";
import { getContractLedger, resolveDomainIdInLedger } from "./core.js";

// ---- Contract instance ----

export const nsContractInstance = CompiledContract.make(
  "ns-contract",
  NS.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(MANAGED_DIR),
);

function getDefaultContractAddress(): string {
  const currentNetwork = getNetworkId();
  return getNetworkConfig(currentNetwork).contractAddress;
}

async function joinNsContract(
  providers: ContractProviders<NS.Contract>,
  contractAddress?: string,
  secretKey?: string,
) {
  const initialPrivateState = secretKey
    ? { secretKey } as any
    : { phantom: false };
  return await findDeployedContract(providers, {
    contractAddress: contractAddress ?? getDefaultContractAddress(),
    compiledContract: nsContractInstance,
    privateStateId: "nsPrivateState",
    initialPrivateState,
  });
}

// ---- Helpers ----

export interface OperationOptions {
  contractAddress?: string;
  secretKey?: string;
}

async function withContract<T>(
  providers: ContractProviders<NS.Contract>,
  label: string,
  fn: (contract: Awaited<ReturnType<typeof joinNsContract>>) => Promise<T>,
  options?: OperationOptions,
): Promise<Result<T>> {
  try {
    const contract = await joinNsContract(providers, options?.contractAddress, options?.secretKey);
    return success(await fn(contract));
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to ${label}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
    );
  }
}

function txId(result: { public: { txId: string } }) {
  return { transactionId: result.public.txId };
}

function targetToContractArgs(target: DomainTarget): { targetBytes: Uint8Array; targetType: AddressType } {
  const parsed = parseAddressToBytes(target.address);
  switch (target.type) {
    case "contract":
      return { targetBytes: parsed.bytes, targetType: AddressType.ContractAddr };
    case "shielded":
      return { targetBytes: parsed.bytes, targetType: AddressType.ZswapCPKAddr };
    case "unshielded":
      return { targetBytes: parsed.bytes, targetType: AddressType.UnshieldedAddr };
  }
}

export function buildKvs(
  fields: Array<[string, string]>,
  size: number = 6,
): Array<{ is_some: boolean; value: [string, string] }> {
  return Array.from({ length: size }, (_, i) => ({
    is_some: i < fields.length,
    value: i < fields.length ? fields[i] : ["", ""],
  }));
}

// ---- Domain creation ----

export async function createDomain(
  domainName: string,
  parentId: bigint,
  ownerDerivedKey: Uint8Array,
  ownerAddress: { bytes: Uint8Array },
  target: DomainTarget,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions & { fields?: Array<[string, string]> },
): Promise<Result<{ transactionId: string }>> {
  const { key, len } = domainToKey(domainName);
  const { targetBytes, targetType } = targetToContractArgs(target);
  const kvs = buildKvs(options?.fields ?? [], 6);
  return withContract(providers, "create domain", async (contract) =>
    txId(await contract.callTx.create_domain(
      ownerDerivedKey, ownerAddress, key, len, parentId, targetBytes, targetType, kvs,
    )),
    options,
  );
}

// ---- Domain updates ----

export async function updateDomain(
  domainId: bigint,
  data: DomainData,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  return withContract(providers, "update domain", async (contract) =>
    txId(await contract.callTx.update_domain(domainId, data)),
    options,
  );
}

export async function transferDomain(
  domainName: string,
  parentId: bigint,
  newOwner: Uint8Array,
  newOwnerAddress: { bytes: Uint8Array },
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  const { key } = domainToKey(domainName);
  return withContract(providers, "transfer domain", async (contract) =>
    txId(await contract.callTx.transfer_domain(key, parentId, newOwner, newOwnerAddress)),
    options,
  );
}

// ---- Field operations ----

export async function addDomainField(
  domainId: bigint,
  key: string,
  value: string,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  return withContract(providers, "add domain field", async (contract) =>
    txId(await contract.callTx.add_domain_field(domainId, key, value)),
    options,
  );
}

export async function addMultipleFields(
  domainId: bigint,
  fields: Array<[string, string]>,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  if (fields.length === 0) {
    return failure(new NetworkError("No fields provided"));
  }
  if (fields.length > 10) {
    return failure(new NetworkError("Maximum of 10 fields can be added at once"));
  }
  const kvs = buildKvs(fields, 10);
  return withContract(providers, "add multiple fields", async (contract) =>
    txId(await contract.callTx.add_multiple_fields(domainId, kvs)),
    options,
  );
}

export async function removeDomainField(
  domainId: bigint,
  key: string,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  return withContract(providers, "remove domain field", async (contract) =>
    txId(await contract.callTx.remove_domain_field(domainId, key)),
    options,
  );
}

export async function clearDomainFields(
  domainId: bigint,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  return withContract(providers, "clear domain fields", async (contract) =>
    txId(await contract.callTx.clear_domain_fields(domainId)),
    options,
  );
}

export async function updateDefaultField(
  domainId: bigint,
  field: string | null,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  const maybe = field !== null
    ? { is_some: true as const, value: field }
    : { is_some: false as const, value: "" };
  return withContract(providers, "update default field", async (contract) =>
    txId(await contract.callTx.update_domain_default_field(domainId, maybe)),
    options,
  );
}

// ---- Granular update helpers (read-modify-write) ----

async function fetchDomainData(
  providers: ContractProviders<NS.Contract>,
  domainId: bigint,
  contractAddress?: string,
): Promise<Result<DomainData>> {
  try {
    const publicDataProvider = (providers as any).publicDataProvider;
    const ledgerResult = await getContractLedger(publicDataProvider, contractAddress);
    if (!ledgerResult.success) return failure(ledgerResult.error);
    if (!ledgerResult.data.id_to_data.member(domainId)) {
      return failure(new NetworkError(`Domain ID ${domainId} not found`));
    }
    return success(ledgerResult.data.id_to_data.lookup(domainId));
  } catch (error) {
    return failure(new NetworkError(`Failed to fetch domain data: ${error instanceof Error ? error.message : String(error)}`, error));
  }
}

export async function updateDomainTarget(
  domainId: bigint,
  target: DomainTarget,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  const dataResult = await fetchDomainData(providers, domainId, options?.contractAddress);
  if (!dataResult.success) return dataResult;
  const data = dataResult.data;
  const { targetBytes, targetType } = targetToContractArgs(target);
  return updateDomain(domainId, { ...data, target: targetBytes, target_type: targetType }, providers, options);
}

export async function updateDomainColor(
  domainId: bigint,
  color: Uint8Array,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  if (color.length !== 32) return failure(new NetworkError("Color must be exactly 32 bytes"));
  const dataResult = await fetchDomainData(providers, domainId, options?.contractAddress);
  if (!dataResult.success) return dataResult;
  return updateDomain(domainId, { ...dataResult.data, coin_color: color }, providers, options);
}

export async function updateDomainCosts(
  domainId: bigint,
  costs: { short: bigint; medium: bigint; long: bigint },
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  const dataResult = await fetchDomainData(providers, domainId, options?.contractAddress);
  if (!dataResult.success) return dataResult;
  return updateDomain(domainId, {
    ...dataResult.data,
    cost_short: costs.short,
    cost_med: costs.medium,
    cost_long: costs.long,
  }, providers, options);
}

export async function updateBuyEnabled(
  domainId: bigint,
  enabled: boolean,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  const dataResult = await fetchDomainData(providers, domainId, options?.contractAddress);
  if (!dataResult.success) return dataResult;
  return updateDomain(domainId, { ...dataResult.data, buy_enabled: enabled }, providers, options);
}

export async function updateDomainCostsAndBuyEnabled(
  domainId: bigint,
  costs: { short: bigint; medium: bigint; long: bigint },
  enabled: boolean,
  providers: ContractProviders<NS.Contract>,
  options?: OperationOptions,
): Promise<Result<{ transactionId: string }>> {
  const dataResult = await fetchDomainData(providers, domainId, options?.contractAddress);
  if (!dataResult.success) return dataResult;
  return updateDomain(domainId, {
    ...dataResult.data,
    cost_short: costs.short,
    cost_med: costs.medium,
    cost_long: costs.long,
    buy_enabled: enabled,
  }, providers, options);
}
