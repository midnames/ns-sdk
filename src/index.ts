// Contract
export {
  NS,
  AddressType,
  ledger,
  Contract,
  MANAGED_DIR,
  witnesses,
  type DomainData,
  type DomainReference,
  type Maybe,
  type PaymentConfig,
  type Witnesses,
  type Ledger,
  type DNSPrivateState,
} from "./contract.js";

// Types
export type {
  DomainTarget,
  DomainInfo,
  DomainSettings,
  DomainProfileData,
} from "./types.js";

// Core read operations
export {
  resolveDomain,
  resolveDefault,
  getDomainInfo,
  getDomainFields,
  getDomainSettings,
  getDomainProfile,
  getSubdomains,
  resolveDomainIdInLedger,
  getContractLedger,
  queryContractState,
  getTargetFromDomainData,
} from "./core.js";

// Write operations
export {
  nsContractInstance,
  buildKvs,
  type OperationOptions,
  createDomain,
  updateDomain,
  transferDomain,
  addDomainField,
  addMultipleFields,
  removeDomainField,
  clearDomainFields,
  updateDefaultField,
  updateDomainTarget,
  updatePaymentConfig,
} from "./operations.js";

// Provider
export {
  NETWORK_REGISTRY,
  getNetworkConfig,
  getDefaultProvider,
  setDefaultProvider,
  createDefaultProvider,
  type NetworkConfig,
} from "./provider.js";

// Results & Errors
export { type Result, success, failure, wrapAsync } from "./results.js";
export {
  MidnamesError,
  NetworkError,
  ContractNotFoundError,
  DomainNotFoundError,
  InvalidDomainError,
} from "./errors.js";

// Utils
export {
  normalizeDomain,
  parseFullDomain,
  isValidDomainName,
  isTLD,
  domainToKey,
  keyToDomain,
  DEFAULT_TLD,
  type ParsedDomain,
} from "./utils/domain.js";
export {
  bytesToHex,
  hexToBytes,
  formatContractAddress,
  formatUnshieldedAddress,
  deriveShieldedAddress,
  isWalletAddress,
  parseAddressToBytes,
} from "./utils/address.js";
export { sanitizeUrl } from "./utils/sanitize.js";
