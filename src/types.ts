export type { DomainData, DomainReference, Maybe } from "./managed/contract/index.js";
export { AddressType } from "./managed/contract/index.js";

export type DomainTarget =
  | { type: "contract"; address: string }
  | { type: "shielded"; address: string }
  | { type: "unshielded"; address: string };

export interface DomainInfo {
  id: bigint;
  owner: string;
  ownerAddress: string;
  target: DomainTarget;
}

export interface DomainSettings {
  coinColor: Uint8Array;
  costs: {
    short: bigint;
    medium: bigint;
    long: bigint;
  };
  buyEnabled: boolean;
  defaultField: string | null;
}

export interface DomainProfileData {
  fullDomain: string;
  info: DomainInfo | null;
  fields: Map<string, string>;
  settings: DomainSettings | null;
}
