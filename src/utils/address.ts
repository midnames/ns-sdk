import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey, ShieldedAddress, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
// Imported rather than taken from the global scope so the SDK works in browsers,
// where `Buffer` is not defined. Node resolves this to its built-in module.
import { Buffer } from "buffer";

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nibble(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 97 && code <= 102) return code - 87; // a-f
  if (code >= 65 && code <= 70) return code - 55; // A-F
  return -1;
}

/**
 * Decode a hex string to bytes. Like `Buffer.from(hex, "hex")`, decoding stops
 * at the first character that is not a hex digit and a trailing half-byte is
 * ignored, but without depending on `Buffer` being present.
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < bytes.length; i++) {
    const high = nibble(hex[i * 2]);
    const low = nibble(hex[i * 2 + 1]);
    if (high < 0 || low < 0) return bytes.subarray(0, i);
    bytes[i] = (high << 4) | low;
  }
  return bytes;
}

export function formatContractAddress(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

export function isWalletAddress(address: string): boolean {
  return address.startsWith("mn_");
}

export function deriveShieldedAddress(coinPublicKeyAddress: string, encryptionPublicKey: string): string | null {
  try {
    const cpkParsed = MidnightBech32m.parse(coinPublicKeyAddress);
    if (cpkParsed.type !== 'shield-cpk') return null;
    const coinPublicKey = ShieldedCoinPublicKey.codec.decode(getNetworkId(), cpkParsed);
    const epkParsed = MidnightBech32m.parse(encryptionPublicKey);
    if (epkParsed.type !== 'shield-epk') return null;
    const encPubKey = ShieldedEncryptionPublicKey.codec.decode(getNetworkId(), epkParsed);
    const shieldedAddress = new ShieldedAddress(coinPublicKey, encPubKey);
    return ShieldedAddress.codec.encode(getNetworkId() as any, shieldedAddress).asString();
  } catch {
    return null;
  }
}

export function formatUnshieldedAddress(bytes: Uint8Array): string {
  const addr = new UnshieldedAddress(Buffer.from(bytes));
  return UnshieldedAddress.codec.encode(getNetworkId() as any, addr).asString();
}

export function parseAddressToBytes(address: string): { bytes: Uint8Array } {
  if (isWalletAddress(address)) {
    const bech32Parsed = MidnightBech32m.parse(address);
    const coinPublicKey = ShieldedCoinPublicKey.codec.decode(getNetworkId(), bech32Parsed);
    return { bytes: new Uint8Array(coinPublicKey.data) };
  }
  const bytes = hexToBytes(address);
  return { bytes: bytes.length === 32 ? bytes : bytes.subarray(-32) };
}
