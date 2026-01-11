import { type LocalAccount as EvmSigner } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createSignableMessage,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
} from "@solana/kit";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import type { Signer as X402Signer } from "x402-fetch";

import bs58 from "bs58";

// Configure ed25519 to use sha512 (required for Node.js)
ed.hashes.sha512 = sha512;

// Type representing a Solana signer with message signing capability
type SvmSigner = {
  address: string;
  signMessages: (messages: any[]) => Promise<any[]>;
};

export async function signerFromPrivateKey(
  privateKey: string
): Promise<X402Signer> {
  if (privateKey.startsWith("0x")) {
    return privateKeyToAccount(privateKey as `0x${string}`) as EvmSigner;
  }

  const decodedBytes = bs58.decode(privateKey);

  if (decodedBytes.length === 64) {
    return createKeyPairSignerFromBytes(decodedBytes);
  }

  if (decodedBytes.length === 32) {
    return createKeyPairSignerFromPrivateKeyBytes(bs58.decode(privateKey));
  }

  throw new Error("Invalid private key");
}

export async function signWithEvm(signer: X402Signer, message: string) {
  const s = signer as EvmSigner;
  return s.signMessage({ message });
}

export async function signWithSolana(signer: X402Signer, message: string) {
  const s = signer as unknown as SvmSigner;

  const signableMessage = createSignableMessage(message);
  const [signedMessage] = await s.signMessages([signableMessage]);

  return Buffer.from(signedMessage[s.address]).toString("base64");
}

export { EvmSigner, SvmSigner };

// ─────────────────────────────────────────────────────────────────────────────
// Grant Utilities
// ─────────────────────────────────────────────────────────────────────────────

import {
  type GrantPayload,
  type SignedGrant,
  GRANT_MESSAGE_PREFIX,
  SHARE_CODE_PREFIX,
} from "./types.js";

/**
 * Build the signable message from a grant payload.
 * Uses canonical JSON (sorted keys) for consistent signing.
 */
export function buildGrantMessage(payload: GrantPayload): string {
  // Sort keys for canonical representation
  const sorted = Object.keys(payload)
    .sort()
    .reduce((acc, key) => {
      const value = payload[key as keyof GrantPayload];
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, unknown>);

  const canonical = JSON.stringify(sorted);
  return `${GRANT_MESSAGE_PREFIX}${Buffer.from(canonical).toString("base64")}`;
}

/**
 * Parse a duration string into seconds.
 * Supports: "30s", "5m", "2h", "7d", "4w"
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdw])$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use format like "7d", "24h", "30m"`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
  };

  return value * multipliers[unit];
}

/**
 * Sign a grant payload with the given signer.
 *
 * @param signer - The x402 signer (EVM or Solana wallet)
 * @param payload - The grant payload to sign (without 'f' - grantor address is added from signer)
 * @returns Complete signed grant
 */
export async function signGrant(
  signer: X402Signer,
  payload: Omit<GrantPayload, "f">
): Promise<SignedGrant> {
  // Get the address from the signer
  const address = (signer as { address: string }).address;
  const isEvm = address.startsWith("0x");

  // Complete the payload with the grantor address
  const completePayload: GrantPayload = {
    ...payload,
    f: address,
  };

  // Build and sign the message
  const message = buildGrantMessage(completePayload);
  const signature = isEvm
    ? await signWithEvm(signer, message)
    : await signWithSolana(signer, message);

  return {
    p: completePayload,
    s: signature,
    c: isEvm ? "evm" : "sol",
  };
}

/**
 * Encode a signed grant as a shareable code.
 */
export function grantToShareCode(grant: SignedGrant): string {
  const json = JSON.stringify(grant);
  return `${SHARE_CODE_PREFIX}${Buffer.from(json).toString("base64url")}`;
}

/**
 * Decode a share code back to a signed grant.
 */
export function grantFromShareCode(code: string): SignedGrant {
  if (!code.startsWith(SHARE_CODE_PREFIX)) {
    throw new Error(`Invalid share code: must start with ${SHARE_CODE_PREFIX}`);
  }

  const encoded = code.slice(SHARE_CODE_PREFIX.length);
  const json = Buffer.from(encoded, "base64url").toString("utf-8");
  return JSON.parse(json) as SignedGrant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attestation Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization with sorted keys.
 * Used to create consistent message for signing/verification.
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }

  // Match server-side sorting order for consistent hashing
  const customOrder = ["id", "kind", "tags"];
  const sortedKeys = Object.keys(obj).sort((a, b) => {
    const aIndex = customOrder.indexOf(a);
    const bIndex = customOrder.indexOf(b);

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a < b ? -1 : 1;
  });

  const pairs = sortedKeys.map(
    (key) =>
      `${JSON.stringify(key)}:${stableStringify(
        (obj as Record<string, unknown>)[key]
      )}`
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Verify an Ed25519 signature.
 */
export function verifyEd25519(
  signature: string,
  message: string,
  publicKey: string
): boolean {
  try {
    const sigBytes = Buffer.from(signature.slice(2), "hex");
    const pubKeyBytes = Buffer.from(publicKey.slice(2), "hex");
    const messageBytes = Buffer.from(message);
    return ed.verify(sigBytes, messageBytes, pubKeyBytes);
  } catch {
    return false;
  }
}
