import { hexToBytes } from "./utils/address.js";

export type DNSPrivateState = {
  secretKey: string; // hex-encoded 32 bytes
};

export const witnesses = {
  domainSecretKey: ({
    privateState,
  }: {
    privateState: DNSPrivateState;
  }): [DNSPrivateState, Uint8Array] => [
    privateState,
    hexToBytes(privateState.secretKey),
  ],
};
