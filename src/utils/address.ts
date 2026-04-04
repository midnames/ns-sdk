import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey, ShieldedAddress, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export function formatContractAddress(bytes: Uint8Array): string {
  return "0200" + bytesToHex(bytes);
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
  let hexString = address;
  if (address.startsWith("0200")) hexString = address.slice(4);
  const bytes = new Uint8Array(Buffer.from(hexString, "hex"));
  return { bytes: bytes.length === 32 ? bytes : bytes.subarray(-32) };
}
