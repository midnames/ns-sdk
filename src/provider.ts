import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";

export interface NetworkConfig {
  indexerUrl: string;
  indexerWsUrl: string;
  contractAddress: string;
}

export const NETWORK_REGISTRY: Record<string, NetworkConfig> = {
  preprod: {
    indexerUrl: "https://indexer.preprod.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    contractAddress: "0e6ff3e64e69fcaf513c13f4f66bfe66ab233e554d5c9fef4f2b16795df2e398",
  },
  mainnet: {
    indexerUrl: "https://indexer.mainnet.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.mainnet.midnight.network/api/v3/graphql/ws",
    contractAddress: "83b0d57aba442f92e12b5cdf92642adb9927ccd554a9061b5bd0992fc72596bb",
  },
};

export function getNetworkConfig(networkId: string): NetworkConfig {
  const config = NETWORK_REGISTRY[networkId];
  if (!config) {
    throw new Error(
      `Unknown network "${networkId}". Known networks: ${Object.keys(NETWORK_REGISTRY).join(", ")}`,
    );
  }
  return config;
}

let defaultProvider: PublicDataProvider | null = null;

export function getDefaultProvider(networkId: string = "mainnet"): PublicDataProvider {
  if (!defaultProvider) {
    const net = getNetworkConfig(networkId);
    setNetworkId(networkId as any);
    defaultProvider = indexerPublicDataProvider(net.indexerUrl, net.indexerWsUrl) as PublicDataProvider;
  }
  return defaultProvider!;
}

export function setDefaultProvider(provider: PublicDataProvider): void {
  defaultProvider = provider;
}

export function createDefaultProvider(config: {
  indexerUrl?: string;
  indexerWsUrl?: string;
  networkId?: string;
} = {}): PublicDataProvider {
  const networkId = config.networkId ?? "mainnet";
  const knownConfig = NETWORK_REGISTRY[networkId];
  const indexerUrl = config.indexerUrl ?? knownConfig?.indexerUrl;
  const indexerWsUrl = config.indexerWsUrl ?? knownConfig?.indexerWsUrl;
  if (!indexerUrl || !indexerWsUrl) {
    throw new Error(
      `No indexer URLs for network "${networkId}". Provide indexerUrl and indexerWsUrl explicitly.`,
    );
  }
  setNetworkId(networkId as any);
  return indexerPublicDataProvider(indexerUrl, indexerWsUrl) as PublicDataProvider;
}
