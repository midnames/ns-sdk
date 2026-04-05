export * as NS from "./managed/contract/index.js";
export {
  type DomainData,
  type DomainReference,
  type Maybe,
  type PaymentConfig,
  type Witnesses,
  type Ledger,
  AddressType,
  ledger,
  Contract,
} from "./managed/contract/index.js";
export { domainToKey, keyToDomain } from "./utils/domain.js";
export { witnesses, type DNSPrivateState } from "./witnesses.js";
export const MANAGED_DIR = new URL("./managed", import.meta.url).href;
