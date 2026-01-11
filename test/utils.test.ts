import { describe, it, expect } from "vitest";
import bs58 from "bs58";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  signerFromPrivateKey,
  signWithEvm,
  type EvmSigner,
  type SvmSigner,
} from "../src/utils";

// Configure ed25519 to use sha512 (required for Node.js)
ed.hashes.sha512 = sha512;

describe("utils", () => {
  describe("signerFromPrivateKey", () => {
    it("should create an EVM signer from a hex string", async () => {
      const pk =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat default
      const signer = (await signerFromPrivateKey(pk)) as EvmSigner;
      expect(signer).toBeDefined();
      expect(signer.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    });

    it("should create a Solana signer from a base58 string (64 bytes)", async () => {
      // Generate a valid 64-byte keypair
      const privKey = ed.utils.randomSecretKey();
      const pubKey = ed.getPublicKey(privKey);
      const fullKey = new Uint8Array(64);
      fullKey.set(privKey);
      fullKey.set(pubKey, 32);
      const base58Key = bs58.encode(fullKey);

      const signer = (await signerFromPrivateKey(base58Key)) as SvmSigner;
      expect(signer).toBeDefined();
      expect(signer.address).toBeDefined();
      expect(typeof signer.signMessages).toBe("function");
    });

    it("should throw on invalid private key", async () => {
      await expect(signerFromPrivateKey("invalid")).rejects.toThrow();
    });
  });

  describe("signWithEvm", () => {
    it("should sign a message with EVM signer", async () => {
      const pk =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat default
      const signer = await signerFromPrivateKey(pk);
      const message = "hello world";
      const signature = await signWithEvm(signer, message);
      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");
      expect(signature.startsWith("0x")).toBe(true);
    });
  });
});
