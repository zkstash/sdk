import { describe, it, expect } from "vitest";
import {
  signerFromPrivateKey,
  signWithEvm,
  type EvmSigner,
} from "../src/utils";

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
      // TODO: implement this test
      throw new Error("Not implemented");
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
