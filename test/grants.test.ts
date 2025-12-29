import { describe, it, expect, beforeAll } from "vitest";

import {
  signGrant,
  buildGrantMessage,
  grantToShareCode,
  grantFromShareCode,
  parseDuration,
  signerFromPrivateKey,
} from "../src/utils";

import type { GrantPayload, SignedGrant } from "../src/types";

// Test private keys (DO NOT USE IN PRODUCTION)
const EVM_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat default

describe("Grant Utilities", () => {
  describe("parseDuration", () => {
    it("should parse seconds", () => {
      expect(parseDuration("30s")).toBe(30);
    });

    it("should parse minutes", () => {
      expect(parseDuration("5m")).toBe(5 * 60);
    });

    it("should parse hours", () => {
      expect(parseDuration("2h")).toBe(2 * 60 * 60);
    });

    it("should parse days", () => {
      expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60);
    });

    it("should parse weeks", () => {
      expect(parseDuration("2w")).toBe(2 * 7 * 24 * 60 * 60);
    });

    it("should throw on invalid format", () => {
      expect(() => parseDuration("invalid")).toThrow();
      expect(() => parseDuration("7x")).toThrow();
    });
  });

  describe("buildGrantMessage", () => {
    it("should build canonical message with sorted keys", () => {
      const payload: GrantPayload = {
        f: "0xAAA",
        g: "0xBBB",
        a: "agent-1",
        e: 1735689600,
      };

      const message = buildGrantMessage(payload);
      expect(message).toMatch(/^zkstash:grant:v1:/);

      // Decode and verify canonical JSON
      const base64Part = message.replace("zkstash:grant:v1:", "");
      const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);

      // Keys should be in alphabetical order
      expect(Object.keys(parsed)).toEqual(["a", "e", "f", "g"]);
    });

    it("should handle optional agentId", () => {
      const payload: GrantPayload = {
        f: "0xAAA",
        g: "0xBBB",
        e: 1735689600,
      };

      const message = buildGrantMessage(payload);
      const base64Part = message.replace("zkstash:grant:v1:", "");
      const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);

      expect(parsed.a).toBeUndefined();
      expect(Object.keys(parsed)).toEqual(["e", "f", "g"]);
    });
  });

  describe("Share Code", () => {
    it("should encode and decode grant correctly", () => {
      const grant: SignedGrant = {
        p: {
          f: "0xAAA",
          g: "0xBBB",
          a: "agent-1",
          e: 1735689600,
        },
        s: "0x123456",
        c: "evm",
      };

      const code = grantToShareCode(grant);
      expect(code).toMatch(/^zkg1_/);

      const decoded = grantFromShareCode(code);
      expect(decoded).toEqual(grant);
    });

    it("should throw on invalid share code prefix", () => {
      expect(() => grantFromShareCode("invalid_code")).toThrow(
        /must start with zkg1_/
      );
    });
  });

  describe("signGrant (EVM)", () => {
    let signer: Awaited<ReturnType<typeof signerFromPrivateKey>>;

    beforeAll(async () => {
      signer = await signerFromPrivateKey(EVM_PRIVATE_KEY);
    });

    it("should sign a grant and set correct chain type", async () => {
      const grant = await signGrant(signer, {
        g: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        e: Math.floor(Date.now() / 1000) + 86400,
      });

      expect(grant.c).toBe("evm");
      expect(grant.p.f).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"); // Hardhat default address
      expect(grant.p.g).toBe("0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
      expect(grant.s).toMatch(/^0x/);
    });

    it("should include optional agentId in grant", async () => {
      const grant = await signGrant(signer, {
        g: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        a: "researcher",
        e: Math.floor(Date.now() / 1000) + 86400,
      });

      expect(grant.p.a).toBe("researcher");
    });

    it("should create verifiable signature", async () => {
      const grant = await signGrant(signer, {
        g: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        e: Math.floor(Date.now() / 1000) + 86400,
      });

      // Verify the signature using viem
      const { verifyMessage } = await import("viem");
      const { mainnet } = await import("viem/chains");
      const { createPublicClient, http } = await import("viem");

      const message = buildGrantMessage(grant.p);

      const valid = await verifyMessage({
        address: grant.p.f as `0x${string}`,
        message,
        signature: grant.s as `0x${string}`,
      });

      expect(valid).toBe(true);
    });
  });
});

describe("Grant Integration", () => {
  it("should create a complete grant flow", async () => {
    // 1. Grantor creates and signs a grant
    const grantorSigner = await signerFromPrivateKey(EVM_PRIVATE_KEY);
    const granteeAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Another Hardhat address

    const grant = await signGrant(grantorSigner, {
      g: granteeAddress,
      a: "knowledge-base",
      e: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
    });

    // 2. Convert to share code
    const shareCode = grantToShareCode(grant);
    expect(shareCode).toMatch(/^zkg1_/);

    // 3. Grantee receives and decodes the share code
    const receivedGrant = grantFromShareCode(shareCode);

    // 4. Verify grant structure
    expect(receivedGrant.p.f).toBe(
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    expect(receivedGrant.p.g).toBe(granteeAddress);
    expect(receivedGrant.p.a).toBe("knowledge-base");
    expect(receivedGrant.c).toBe("evm");

    // 5. Grantee can verify the signature
    const { verifyMessage } = await import("viem");
    const message = buildGrantMessage(receivedGrant.p);
    const valid = await verifyMessage({
      address: receivedGrant.p.f as `0x${string}`,
      message,
      signature: receivedGrant.s as `0x${string}`,
    });
    expect(valid).toBe(true);
  });
});
