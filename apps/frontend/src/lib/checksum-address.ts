import { keccak_256 } from "js-sha3";

/**
 * Returns EIP-55 checksum address.
 * Reference: https://eips.ethereum.org/EIPS/eip-55
 */
export function toChecksumAddress(address: string): string {
  if (!address) return address;
  const addr = address.toLowerCase().replace(/^0x/, "");
  const hash = keccak_256(addr);
  let result = "0x";
  for (let i = 0; i < addr.length; i++) {
    const hashChar = hash[i] ?? "0";
    const addrChar = addr[i] ?? "";
    result +=
      parseInt(hashChar, 16) >= 8 ? addrChar.toUpperCase() : addrChar;
  }
  return result;
}
