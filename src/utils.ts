
import { type LocalAccount as EvmSigner } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createSignableMessage,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
} from "@solana/kit";

import type { Signer as X402Signer } from "x402-fetch";

import bs58 from 'bs58';

// Type representing a Solana signer with message signing capability
type SvmSigner = {
  address: string;
  signMessages: (messages: any[]) => Promise<any[]>;
};

export async function signerFromPrivateKey(privateKey: string): Promise<X402Signer> {
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