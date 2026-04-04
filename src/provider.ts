import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";

export interface NetworkConfig {
  indexerUrl: string;
  indexerWsUrl: string;
  contractAddress: string;
}

export const NETWORK_REGISTRY: Record<string, NetworkConfig> = {
  preview: {
    indexerUrl: "https://indexer.preview.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.preview.midnight.network/api/v3/graphql/ws",
    contractAddress: "", // TODO: set after deployment
  },
  preprod: {
    indexerUrl: "https://indexer.preprod.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    contractAddress: "a578a713c150d12b0fb31197051f8aa4112b0aca4077fca7a33f552b3cada1e1",
  },
  mainnet: {
    indexerUrl: "https://indexer.mainnet.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.mainnet.midnight.network/api/v3/graphql/ws",
    contractAddress: "", // TODO: set after deployment
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
