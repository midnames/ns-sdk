import "dotenv/config";
import type { DomainEntry, BatchDeployConfig, DomainSettings } from "./batch-config";

// Midnight SDK Imports
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  nativeToken,
} from "@midnight-ntwrk/ledger-v8";
import {
  type MidnightProvider,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NetworkId } from "@midnight-ntwrk/wallet-sdk-abstractions";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  deployContract,
  findDeployedContract,
  type ContractProviders,
  type DeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";

import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";

import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { NS, witnesses, AddressType } from "../contract.js";
import { domainToKey } from "../utils/domain.js";

import * as Rx from "rxjs";
import * as path from "node:path";
import * as fs from "node:fs";
import { createHash, randomBytes, createCipheriv } from "crypto";
import { WebSocket } from "ws";
import { Buffer } from "buffer";
import { type Logger } from "pino";
import pinoPretty from "pino-pretty";
import pino from "pino";
import * as bip39 from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";

// @ts-expect-error: Needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─── Logger ─────────────────────────────────────────────────────────────────
const logger: Logger = pino(
  {
    level:
      process.env.DEBUG_LEVEL !== undefined &&
      process.env.DEBUG_LEVEL !== null &&
      process.env.DEBUG_LEVEL !== ""
        ? process.env.DEBUG_LEVEL
        : "info",
    depthLimit: 20,
  },
  pinoPretty({
    colorize: true,
    sync: true,
    customColors: { debug: "green" },
  }),
);

// ─── Network Config ─────────────────────────────────────────────────────────
interface NetworkConfig {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly networkId: string;
}

function makePreviewConfig(): NetworkConfig {
  const cfg = {
    indexer: "https://indexer.preview.midnight.network/api/v3/graphql",
    indexerWS: "wss://indexer.preview.midnight.network/api/v3/graphql/ws",
    node: "wss://rpc.preview.midnight.network",
    proofServer: "https://ps.midnames.com",
    networkId: "preview",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

function makePreprodConfig(): NetworkConfig {
  const cfg = {
    indexer: "https://indexer.preprod.midnight.network/api/v3/graphql",
    indexerWS: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    node: "wss://rpc.preprod.midnight.network",
    proofServer: "https://ps.midnames.com",
    networkId: "preprod",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

function makeMainnetConfig(): NetworkConfig {
  const cfg = {
    indexer: "https://indexer.mainnet.midnight.network/api/v3/graphql",
    indexerWS: "wss://indexer.mainnet.midnight.network/api/v3/graphql/ws",
    node: "wss://rpc.mainnet.midnight.network",
    proofServer: "https://ps.midnames.com",
    networkId: "mainnet",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

function makeStandaloneConfig(): NetworkConfig {
  const cfg = {
    indexer: "http://127.0.0.1:8088/api/v3/graphql",
    indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
    node: "ws://127.0.0.1:9944",
    proofServer: "http://127.0.0.1:6300",
    networkId: "undeployed",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

// ─── Wallet Cache ──────────────────────────────────────────────────────────
const WALLET_CACHE_PATH = path.resolve(".midnight-wallet-cache.json");

interface WalletCache {
  shielded: string;
  unshielded: string;
  dust: string;
}

function readWalletCache(): WalletCache | null {
  try {
    const raw = fs.readFileSync(WALLET_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.shielded && parsed.unshielded && parsed.dust) {
      return parsed as WalletCache;
    }
    return null;
  } catch {
    return null;
  }
}

function writeWalletCache(cache: WalletCache): void {
  try {
    fs.writeFileSync(WALLET_CACHE_PATH, JSON.stringify(cache), "utf-8");
    logger.info("Wallet state cached");
  } catch (e) {
    logger.error(`Failed to write wallet cache: ${e}`);
  }
}

// ─── Wallet Types & Helpers ─────────────────────────────────────────────────
interface WalletContext {
  wallet: WalletFacade;
  shieldedWallet: any;
  unshieldedWallet: any;
  dustWallet: any;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

type UnboundTransaction = ledger.Transaction<
  ledger.SignatureEnabled,
  ledger.Proof,
  ledger.PreBinding
>;

// ─── Contract Instance ──────────────────────────────────────────────────────
const zkConfigPath = path.resolve(import.meta.dirname, "..", "managed");

const nsContractInstance = CompiledContract.make(
  "ns-contract",
  NS.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Helpers ────────────────────────────────────────────────────────────────
const ZERO_ADDR =
  "0000000000000000000000000000000000000000000000000000000000000000";

async function mnemonicToHexSeed(mnemonic: string): Promise<string> {
  if (!bip39.validateMnemonic(mnemonic, english)) {
    throw new Error("Invalid BIP39 mnemonic");
  }
  const seed = await bip39.mnemonicToSeed(mnemonic, "");
  return Buffer.from(seed).toString("hex");
}

async function resolveSeed(configSeed?: string): Promise<string> {
  const raw = configSeed ?? process.env.SEED;
  if (!raw) {
    throw new Error("No seed provided — set SEED in .env or walletSeed in config");
  }
  if (/^[0-9a-fA-F]{64,}$/.test(raw)) {
    return raw;
  }
  return await mnemonicToHexSeed(raw);
}

/**
 * Compute the derived public key that matches the contract's derive_public_key():
 *   persistentHash<[Bytes<32>, Bytes<32>]>([pad(32, "midnight.domains"), secretKey])
 * which is sha256(tag || secretKey).
 */
function computeDerivedKey(secretKeyHex: string): Uint8Array {
  const tag = Buffer.alloc(32, 0);
  tag.write("midnight.domains", "utf8");
  const secretKeyBytes = Buffer.from(secretKeyHex, "hex");
  const input = Buffer.concat([tag, secretKeyBytes]);
  return new Uint8Array(createHash("sha256").update(input).digest());
}

// ─── Wallet Lifecycle ───────────────────────────────────────────────────────
const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        logger.info(`Waiting for wallet sync. Synced: ${state.isSynced}`);
      }),
      Rx.filter((state) => state.isSynced),
    ),
  );

const waitForFunds = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const unshielded = state.unshielded?.balances[nativeToken().raw] ?? 0n;
        const shielded = state.shielded?.balances[nativeToken().raw] ?? 0n;
        logger.info(
          `Waiting for funds. Synced: ${state.isSynced}, Unshielded: ${unshielded}, Shielded: ${shielded}`,
        );
      }),
      Rx.filter((state) => state.isSynced),
    ),
  );

const displayWalletBalances = async (
  wallet: WalletFacade,
): Promise<{ unshielded: bigint; shielded: bigint; total: bigint }> => {
  const state = await Rx.firstValueFrom(wallet.state());
  const unshielded = state.unshielded?.balances[nativeToken().raw] ?? 0n;
  const shielded = state.shielded?.balances[nativeToken().raw] ?? 0n;
  const total = unshielded + shielded;
  logger.info(`Unshielded: ${unshielded}, Shielded: ${shielded}, Total: ${total} tSTAR`);
  return { unshielded, shielded, total };
};

const registerNightForDust = async (
  walletContext: WalletContext,
): Promise<boolean> => {
  const state = await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const unregisteredNightUtxos =
    state.unshielded?.availableCoins.filter(
      (coin) =>
        coin.utxo.type === ZERO_ADDR &&
        coin.meta.registeredForDustGeneration === false,
    ) ?? [];

  if (unregisteredNightUtxos.length === 0) {
    const dustBalance = state.dust
      ? state.dust.capabilities.coinsAndBalances.getWalletBalance(state.dust.state, new Date())
      : 0n;
    logger.info(`Current dust balance: ${dustBalance}`);
    return dustBalance > 0n;
  }

  logger.info(
    `Found ${unregisteredNightUtxos.length} unregistered Night UTXOs, registering for dust...`,
  );

  try {
    const recipe =
      await walletContext.wallet.registerNightUtxosForDustGeneration(
        unregisteredNightUtxos,
        walletContext.unshieldedKeystore.getPublicKey(),
        (payload) => walletContext.unshieldedKeystore.signData(payload),
      );

    const finalizedTx = await walletContext.wallet.finalizeTransaction(
      recipe.transaction,
    );
    const txId = await walletContext.wallet.submitTransaction(finalizedTx);
    logger.info(`Dust registration submitted: ${txId}`);

    logger.info("Waiting for dust to be generated...");
    await Rx.firstValueFrom(
      walletContext.wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.tap((s) => {
          const dustBalance = s.dust
            ? s.dust.capabilities.coinsAndBalances.getWalletBalance(s.dust.state, new Date())
            : 0n;
          logger.debug(`Dust balance: ${dustBalance}`);
        }),
        Rx.filter((s) => {
          const dustBalance = s.dust
            ? s.dust.capabilities.coinsAndBalances.getWalletBalance(s.dust.state, new Date())
            : 0n;
          return dustBalance > 0n;
        }),
      ),
    );

    logger.info("Dust registration complete!");
    return true;
  } catch (e) {
    logger.error(`Failed to register Night UTXOs for dust: ${e}`);
    return false;
  }
};

const initWalletWithSeed = async (
  seed: Buffer,
  config: NetworkConfig,
): Promise<WalletContext> => {
  const hdWallet = HDWallet.fromSeed(seed);
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet");
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive keys");
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(
    derivationResult.keys[Roles.Zswap],
  );
  const dustSecretKey = ledger.DustSecretKey.fromSeed(
    derivationResult.keys[Roles.Dust],
  );
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    config.networkId as NetworkId.NetworkId,
  );

  const walletConfiguration = {
    networkId: config.networkId as NetworkId.NetworkId,
    costParameters: {
      additionalFeeOverhead: 1_000_000_000n,
      feeBlocksMargin: 5,
    },
    relayURL: new URL(config.node),
    provingServerUrl: new URL(config.proofServer),
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    indexerUrl: config.indexerWS,
  };

  const cache = readWalletCache();

  let shieldedWallet: any;
  let dustWallet: any;
  let unshieldedWallet: any;

  if (cache) {
    logger.info("Restoring wallet from cached state...");
  } else {
    logger.info("No wallet cache found, starting fresh sync...");
  }

  const facade = await WalletFacade.init({
    configuration: walletConfiguration,
    shielded: (cfg: any) => {
      if (cache) {
        try {
          shieldedWallet = ShieldedWallet(cfg).restore(cache.shielded);
          return shieldedWallet;
        } catch (e) {
          logger.warn(`Failed to restore shielded wallet from cache: ${e}`);
        }
      }
      shieldedWallet = ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys);
      return shieldedWallet;
    },
    dust: (cfg: any) => {
      if (cache) {
        try {
          dustWallet = DustWallet(cfg).restore(cache.dust);
          return dustWallet;
        } catch (e) {
          logger.warn(`Failed to restore dust wallet from cache: ${e}`);
        }
      }
      dustWallet = DustWallet(cfg).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      );
      return dustWallet;
    },
    unshielded: (cfg: any) => {
      if (cache) {
        try {
          unshieldedWallet = UnshieldedWallet({
            ...cfg,
            txHistoryStorage: new InMemoryTransactionHistoryStorage(),
          }).restore(cache.unshielded);
          return unshieldedWallet;
        } catch (e) {
          logger.warn(`Failed to restore unshielded wallet from cache: ${e}`);
        }
      }
      unshieldedWallet = UnshieldedWallet({
        ...cfg,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
      }).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore));
      return unshieldedWallet;
    },
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);

  return { wallet: facade, shieldedWallet, unshieldedWallet, dustWallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

const buildWalletAndWaitForFunds = async (
  config: NetworkConfig,
  hexSeed: string,
): Promise<WalletContext> => {
  logger.info("Building wallet from hex seed...");
  const seed = Buffer.from(hexSeed, "hex");
  const walletContext = await initWalletWithSeed(seed, config);

  logger.info(
    `Wallet address: ${walletContext.unshieldedKeystore.getBech32Address().asString()}`,
  );

  logger.info("Waiting for wallet to sync...");
  await waitForSync(walletContext.wallet);

  const { total } = await displayWalletBalances(walletContext.wallet);
  if (total === 0n) {
    logger.info("Waiting to receive tokens...");
    await waitForFunds(walletContext.wallet);
    await displayWalletBalances(walletContext.wallet);
  }

  const dustRegistered = await registerNightForDust(walletContext);
  if (!dustRegistered) {
    logger.warn("Dust registration failed — deployment may fail without dust for fees");
  }

  return walletContext;
};

const createWalletAndMidnightProvider = async (
  walletContext: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  return {
    getCoinPublicKey(): ledger.CoinPublicKey {
      return walletContext.shieldedSecretKeys
        .coinPublicKey as unknown as ledger.CoinPublicKey;
    },
    getEncryptionPublicKey(): ledger.EncPublicKey {
      return walletContext.shieldedSecretKeys
        .encryptionPublicKey as unknown as ledger.EncPublicKey;
    },
    async balanceTx(
      tx: UnboundTransaction,
      ttl?: Date,
    ): Promise<ledger.FinalizedTransaction> {
      const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
      const recipe = await walletContext.wallet.balanceUnboundTransaction(tx, {
        shieldedSecretKeys: walletContext.shieldedSecretKeys,
        dustSecretKey: walletContext.dustSecretKey,
      }, { ttl: txTtl });

      const signSegment = (data: Uint8Array) =>
        walletContext.unshieldedKeystore.signData(data);
      const signedRecipe = await walletContext.wallet.signRecipe(recipe, signSegment);

      return await walletContext.wallet.finalizeRecipe(signedRecipe);
    },
    async submitTx(
      tx: ledger.FinalizedTransaction,
    ): Promise<ledger.TransactionId> {
      return await walletContext.wallet.submitTransaction(tx);
    },
  };
};

const configureProviders = async (
  walletContext: WalletContext,
  config: NetworkConfig,
) => {
  setNetworkId(config.networkId);
  const walletAndMidnightProvider =
    await createWalletAndMidnightProvider(walletContext);

  const zkConfig = new NodeZkConfigProvider<string>(zkConfigPath);

  return {
    privateStateProvider: levelPrivateStateProvider<"nsPrivateState">({
      privateStoragePasswordProvider: () => "Midnames-private-state-42",
      accountId: walletContext.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(
      config.indexer,
      config.indexerWS,
    ),
    zkConfigProvider: zkConfig,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfig),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

// ─── Contract Deployment ────────────────────────────────────────────────────
const DEFAULT_DOMAIN_SETTINGS: Required<DomainSettings> = {
  coinColor: nativeToken().raw.toString().replace("0x", ""),
  costs: { short: 100n, medium: 10n, long: 1n },
  buyEnabled: true,
};

function resolveDomainSettings(
  perDomain?: DomainSettings,
  globalDefaults?: DomainSettings,
): Required<DomainSettings> {
  return {
    coinColor: perDomain?.coinColor ?? globalDefaults?.coinColor ?? DEFAULT_DOMAIN_SETTINGS.coinColor,
    costs: {
      short: perDomain?.costs?.short ?? globalDefaults?.costs?.short ?? DEFAULT_DOMAIN_SETTINGS.costs.short,
      medium: perDomain?.costs?.medium ?? globalDefaults?.costs?.medium ?? DEFAULT_DOMAIN_SETTINGS.costs.medium,
      long: perDomain?.costs?.long ?? globalDefaults?.costs?.long ?? DEFAULT_DOMAIN_SETTINGS.costs.long,
    },
    buyEnabled: perDomain?.buyEnabled ?? globalDefaults?.buyEnabled ?? DEFAULT_DOMAIN_SETTINGS.buyEnabled,
  };
}

async function deployNsContract(
  providers: ContractProviders,
  tld: string,
  coinPublicKeyBytes: Uint8Array,
  ownerAddressBytes: Uint8Array,
  secretKeyHex: string,
  rootFields: [string, string][] = [],
  rootSettings: Required<DomainSettings> = DEFAULT_DOMAIN_SETTINGS,
) {
  logger.info(`Deploying NS contract for TLD: ${tld}`);
  logger.info(`  coinColor: ${rootSettings.coinColor}`);
  logger.info(`  costs: short=${rootSettings.costs.short}, medium=${rootSettings.costs.medium}, long=${rootSettings.costs.long}`);
  logger.info(`  buyEnabled: ${rootSettings.buyEnabled}`);
  logger.info(`  rootFields: ${rootFields.length}`);

  // Build kvs: Vector<6, Maybe<[string, string]>>
  const kvs: Array<{ is_some: boolean; value: [string, string] }> = [];
  for (const [key, value] of rootFields.slice(0, 6)) {
    kvs.push({ is_some: true, value: [key, value] });
  }
  while (kvs.length < 6) {
    kvs.push({ is_some: false, value: ["", ""] });
  }

  const deployedContract = await deployContract(providers, {
    compiledContract: nsContractInstance as any,
    privateStateId: "nsPrivateState",
    initialPrivateState: { secretKey: secretKeyHex },
    args: [
      tld,                                                              // tld
      coinPublicKeyBytes,                                               // target (root points to deployer)
      NS.AddressType.ZswapCPKAddr,                                     // target_type
      new Uint8Array(Buffer.from(rootSettings.coinColor, "hex")),       // coin_color
      rootSettings.costs.short,                                         // cost_short
      rootSettings.costs.medium,                                        // cost_med
      rootSettings.costs.long,                                          // cost_long
      { is_some: false, value: "" },                                    // default_field
      rootSettings.buyEnabled,                                          // buy_enabled
      { bytes: ownerAddressBytes },                                     // owner_address
      kvs,                                                              // kvs
    ],
  });

  logger.info(
    `NS contract deployed at: ${deployedContract.deployTxData.public.contractAddress}`,
  );
  return deployedContract;
}

// ─── Service Check ──────────────────────────────────────────────────────────
async function checkServiceAvailability(url: string): Promise<boolean> {
  try {
    if (url.startsWith("ws://") || url.startsWith("wss://")) {
      return new Promise<boolean>((resolve) => {
        const ws = new WebSocket(url);
        const timeoutId = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);
        ws.on("open", () => {
          clearTimeout(timeoutId);
          ws.close();
          resolve(true);
        });
        ws.on("error", () => {
          clearTimeout(timeoutId);
          resolve(false);
        });
      });
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal, method: "GET" });
    clearTimeout(timeoutId);
    return response.status < 500;
  } catch {
    return false;
  }
}

async function checkAllServices(config: NetworkConfig): Promise<boolean> {
  logger.info("Checking service availability...");
  const services = [
    { name: "Indexer", url: config.indexer },
    { name: "Node", url: config.node },
    { name: "Proof Server", url: config.proofServer },
  ];

  const results = await Promise.all(
    services.map(async (service) => {
      const available = await checkServiceAvailability(service.url);
      logger.info(
        `${service.name} (${service.url}): ${available ? "Available" : "Unavailable"}`,
      );
      return { ...service, available };
    }),
  );

  const allAvailable = results.every((s) => s.available);
  if (!allAvailable) {
    logger.error("Some services are unavailable.");
  } else {
    logger.info("All services are available");
  }
  return allAvailable;
}

// ─── Topological Sort ───────────────────────────────────────────────────────
function topologicalSort(
  domains: DomainEntry[],
  tld: string,
): DomainEntry[] {
  const configDomainSet = new Set(domains.map((d) => d.domain));

  // Validate parents exist in config or are TLD
  for (const entry of domains) {
    const parts = entry.domain.split(".");
    if (parts.length > 1) {
      const parentDomain = parts.slice(1).join(".");
      if (!configDomainSet.has(parentDomain) && parentDomain !== tld) {
        throw new Error(
          `Parent "${parentDomain}" for domain "${entry.domain}" is not in config`,
        );
      }
    }
  }

  // Build adjacency
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const entry of domains) {
    inDegree.set(entry.domain, 0);
    children.set(entry.domain, []);
  }

  for (const entry of domains) {
    const parts = entry.domain.split(".");
    if (parts.length > 1) {
      const parentDomain = parts.slice(1).join(".");
      if (configDomainSet.has(parentDomain)) {
        children.get(parentDomain)!.push(entry.domain);
        inDegree.set(entry.domain, (inDegree.get(entry.domain) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [domain, degree] of inDegree) {
    if (degree === 0) queue.push(domain);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const child of children.get(current) ?? []) {
      const newDegree = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0) queue.push(child);
    }
  }

  if (sorted.length !== domains.length) {
    throw new Error(
      "Cycle detected in domain hierarchy — cannot determine deployment order",
    );
  }

  const entryMap = new Map(domains.map((d) => [d.domain, d]));
  return sorted.map((name) => entryMap.get(name)!);
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateConfig(config: BatchDeployConfig): void {
  const domainNames = config.domains.map((d) => d.domain);
  const duplicates = domainNames.filter(
    (name, i) => domainNames.indexOf(name) !== i,
  );
  if (duplicates.length > 0) {
    throw new Error(`Duplicate domains: ${duplicates.join(", ")}`);
  }

  if (config.rootFields && config.rootFields.length > 6) {
    throw new Error(
      `Root fields has ${config.rootFields.length} entries (max 6 for constructor)`,
    );
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────
async function batchDeploy(config: BatchDeployConfig): Promise<void> {
  const tld = config.tld ?? "night";

  validateConfig(config);

  const sortedDomains = topologicalSort(config.domains, tld);
  logger.info(
    `Deployment order: ${sortedDomains.map((d) => d.domain).join(" -> ")}`,
  );

  // Setup network
  const networkConfig =
    config.network === "preview"
      ? makePreviewConfig()
      : config.network === "preprod"
        ? makePreprodConfig()
        : config.network === "mainnet"
          ? makeMainnetConfig()
          : makeStandaloneConfig();

  const servicesOk = await checkAllServices(networkConfig);
  if (!servicesOk) {
    throw new Error("Required services are unavailable");
  }

  const seed = await resolveSeed(config.walletSeed);
  const walletContext = await buildWalletAndWaitForFunds(networkConfig, seed);

  try {
    const providers = await configureProviders(walletContext, networkConfig);

    // Get coin public key for target
    const coinPublicKey = walletContext.shieldedSecretKeys
      .coinPublicKey as unknown as ledger.CoinPublicKey;
    const coinPublicKeyBytes = new Uint8Array(
      (coinPublicKey as any).raw ||
        Buffer.from(coinPublicKey.toString().replace("0x", ""), "hex"),
    );
    const ownerAddressBytes = new Uint8Array(
      Buffer.from(
        walletContext.unshieldedKeystore.getAddress().toString().replace("0x", ""),
        "hex",
      ),
    );

    const secretKeyHex = process.env.MIDNIGHT_SECRET_KEY;
    if (!secretKeyHex) {
      throw new Error("MIDNIGHT_SECRET_KEY env variable is required");
    }

    const derivedKey = computeDerivedKey(secretKeyHex);

    // Deploy or join contract
    let contract:
      | FoundContract<any>
      | DeployedContract<any>;

    if (config.contractAddress) {
      logger.info(`Joining existing NS contract: ${config.contractAddress}`);
      contract = await findDeployedContract(providers, {
        contractAddress: config.contractAddress,
        compiledContract: nsContractInstance as any,
        privateStateId: "nsPrivateState",
        initialPrivateState: { secretKey: secretKeyHex },
      });
    } else {
      const rootSettings = resolveDomainSettings(undefined, config.defaults);
      contract = await deployNsContract(
        providers,
        tld,
        coinPublicKeyBytes,
        ownerAddressBytes,
        secretKeyHex,
        config.rootFields ?? [],
        rootSettings,
      );
    }

    const contractAddress = contract.deployTxData.public.contractAddress;
    logger.info(`Contract address: ${contractAddress}`);

    // Track domain IDs: domain_name -> id
    const domainIds = new Map<string, bigint>();
    domainIds.set(tld, 0n); // root

    // Phase 1: Create all domains
    for (const entry of sortedDomains) {
      logger.info("Waiting for indexer to process recent blocks...");
      await new Promise((r) => setTimeout(r, 6_500));
      logger.info("Syncing wallet state...");
      await waitForSync(walletContext.wallet);
      await displayWalletBalances(walletContext.wallet);

      const hasDust = await registerNightForDust(walletContext);
      if (!hasDust) {
        logger.warn("Dust depleted — waiting for dust regeneration...");
      }

      const parts = entry.domain.split(".");
      const domainName = parts[0];
      const parentDomainPath = parts.length > 1 ? parts.slice(1).join(".") : tld;

      const parentId = domainIds.get(parentDomainPath);
      if (parentId === undefined) {
        throw new Error(
          `Parent ID for "${parentDomainPath}" not found — this should not happen after topological sort`,
        );
      }

      const { key, len } = domainToKey(domainName);

      // First 6 fields go into the create_domain TX, rest are batched after
      const inlineFields = entry.fields.slice(0, 6);
      const remainingFields = entry.fields.slice(6);

      // Build kvs for inline fields
      const kvs: Array<{ is_some: boolean; value: [string, string] }> = [];
      for (const [k, v] of inlineFields) {
        kvs.push({ is_some: true, value: [k, v] });
      }
      while (kvs.length < 6) {
        kvs.push({ is_some: false, value: ["", ""] });
      }

      logger.info(`Creating domain: ${entry.domain} (parent_id=${parentId}, inline_fields=${inlineFields.length})`);

      const result = await contract.callTx.create_domain(
        derivedKey, { bytes: ownerAddressBytes }, key, len,
        parentId, coinPublicKeyBytes, NS.AddressType.ZswapCPKAddr, kvs,
      );
      logger.info(`Domain "${entry.domain}" created. Tx: ${result.public.txId}`);

      // Query state to get the new domain's ID
      logger.info("Waiting for TX to settle...");
      await new Promise((r) => setTimeout(r, 6_500));
      await waitForSync(walletContext.wallet);

      const state = await providers.publicDataProvider.queryContractState(contractAddress);
      const contractLedger = NS.ledger(state!.data);
      const ref = { domain: key, parent_id: parentId };
      if (!contractLedger.name_to_id.member(ref)) {
        throw new Error(`Domain "${entry.domain}" was not found after creation — TX may have failed`);
      }
      const domainId = contractLedger.name_to_id.lookup(ref);
      domainIds.set(entry.domain, domainId);
      logger.info(`Domain "${entry.domain}" assigned ID: ${domainId}`);

      // Phase 2 (inline): Update settings if needed
      const domainSettings = resolveDomainSettings(entry.settings, config.defaults);
      const needsSettingsUpdate =
        domainSettings.coinColor !== DEFAULT_DOMAIN_SETTINGS.coinColor ||
        domainSettings.costs.short !== 0n ||
        domainSettings.costs.medium !== 0n ||
        domainSettings.costs.long !== 0n ||
        domainSettings.buyEnabled !== false;

      if (needsSettingsUpdate) {
        logger.info(`Updating settings for "${entry.domain}"...`);

        const currentData = contractLedger.id_to_data.lookup(domainId);
        const updatedData = {
          owner_public_key: currentData.owner_public_key,
          owner_address: currentData.owner_address,
          target: currentData.target,
          target_type: currentData.target_type,
          default_field: currentData.default_field,
          cost_short: domainSettings.costs.short,
          cost_med: domainSettings.costs.medium,
          cost_long: domainSettings.costs.long,
          coin_color: new Uint8Array(Buffer.from(domainSettings.coinColor, "hex")),
          buy_enabled: domainSettings.buyEnabled,
        };

        const updateResult = await contract.callTx.update_domain(domainId, updatedData);
        logger.info(`Settings updated. Tx: ${updateResult.public.txId}`);

        await new Promise((r) => setTimeout(r, 6_500));
        await waitForSync(walletContext.wallet);
      }

      // Phase 3 (inline): Add remaining fields in batches of 10
      for (let i = 0; i < remainingFields.length; i += 10) {
        const batch = remainingFields.slice(i, i + 10);
        logger.info(`Adding ${batch.length} field(s) to "${entry.domain}" (batch ${Math.floor(i / 10) + 1})...`);

        const batchKvs: Array<{ is_some: boolean; value: [string, string] }> = [];
        for (const [k, v] of batch) {
          batchKvs.push({ is_some: true, value: [k, v] });
        }
        while (batchKvs.length < 10) {
          batchKvs.push({ is_some: false, value: ["", ""] });
        }

        const fieldResult = await contract.callTx.add_multiple_fields(domainId, batchKvs);
        logger.info(`Fields added. Tx: ${fieldResult.public.txId}`);

        await new Promise((r) => setTimeout(r, 6_500));
        await waitForSync(walletContext.wallet);
      }
    }

    // Print results
    logger.info("\n=== Deployment Summary ===");
    logger.info(`Contract: ${contractAddress}`);
    const results: Record<string, string> = {
      contract: contractAddress,
    };
    for (const [domain, id] of domainIds) {
      results[domain] = id.toString();
      logger.info(`${domain}: ID ${id}`);
    }

    console.log(JSON.stringify(results, null, 2));

    // Build backup
    const exportPassword = process.env.EXPORT_PASSWORD;
    if (exportPassword) {
      logger.info("\n=== Building Backup ===");

      const { pbkdf2Sync } = await import("crypto");
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const encKey = pbkdf2Sync(exportPassword, salt, 100_000, 32, "sha256");
      const cipher = createCipheriv("aes-256-gcm", encKey, iv);
      const encrypted = Buffer.concat([cipher.update(secretKeyHex, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const encryptedSecretKey = {
        data: Buffer.concat([encrypted, authTag]).toString("hex"),
        salt: salt.toString("hex"),
        iv: iv.toString("hex"),
      };

      const derivedKeyHex = Buffer.from(derivedKey).toString("hex");
      const now = Date.now();
      const keyRegistry = Array.from(domainIds.keys()).map((domain) => ({
        id: crypto.randomUUID(),
        derivedKey: derivedKeyHex,
        label: domain,
        domain,
        createdAt: now,
        encryptedSecretKey,
      }));

      const exportData = {
        keyRegistry,
        exportedAt: new Date().toISOString(),
      };

      const exportPath = path.resolve("batch-deploy-export.json");
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), "utf-8");
      logger.info(`Backup written to: ${exportPath}`);
    }
  } finally {
    try {
      logger.info("Serializing wallet state...");
      const shielded = await walletContext.shieldedWallet.serializeState();
      const unshielded = await walletContext.unshieldedWallet.serializeState();
      const dust = await walletContext.dustWallet.serializeState();
      writeWalletCache({ shielded, unshielded, dust });
    } catch (e) {
      logger.error(`Error saving wallet state: ${e}`);
    }

    try {
      await walletContext.wallet.stop();
      logger.info("Wallet closed");
    } catch (e) {
      logger.error(`Error closing wallet: ${e}`);
    }
  }
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────
if (import.meta.main) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error(
      "Usage: bun run batch-deploy.ts <config-file.ts>\n\nExample: bun run src/test/batch-deploy.ts src/test/example-deploy.config.ts",
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(configPath);
  const configModule = await import(resolvedPath);
  const deployConfig: BatchDeployConfig = configModule.config;

  if (!deployConfig) {
    console.error(
      `Config file must export a "config" named export of type BatchDeployConfig`,
    );
    process.exit(1);
  }

  await batchDeploy(deployConfig);
}

export { batchDeploy };
