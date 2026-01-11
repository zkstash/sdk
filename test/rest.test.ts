import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZkStash, fromApiKey } from "../src/rest";
import type { CreateMemoryRequest, Attestation } from "../src/types";

import { z } from "zod";

// Mock fetch globally
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe("ZkStash REST Client", () => {
  let client: ZkStash;
  const apiKey = "zk_test_key";
  const baseUrl = "https://api.zkstash.ai";

  beforeEach(() => {
    fetchMock.mockReset();
    client = fromApiKey(apiKey);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Memories", () => {
    it("should create a memory", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "mem_123" }),
      });

      const payload: CreateMemoryRequest = {
        agentId: "agent_1",
        conversation: [{ role: "user", content: "hello" }],
      };

      const res = await client.createMemory(payload);

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/memories`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          }),
          body: JSON.stringify(payload),
        })
      );
      expect(res).toEqual({ id: "mem_123" });
    });

    it("should update a memory", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await client.updateMemory("mem_123", { tags: ["important"] });

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/memories/mem_123`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ tags: ["important"] }),
        })
      );
    });

    it("should delete a memory", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await client.deleteMemory("mem_123");

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/memories/mem_123`,
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    it("should search memories", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await client.searchMemories({
        query: "test",
        filters: { agentId: "agent_1" },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `${baseUrl}/memories/search?query=test&agentId=agent_1`
        ),
        expect.objectContaining({
          method: "GET",
        })
      );
    });
  });

  describe("Schemas", () => {
    it("should register a schema", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await client.registerSchema({
        name: "test_schema",
        description: "A test schema",
        uniqueOn: ["kind"],
        schema: z.object({ foo: z.string() }),
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/schemas`,
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should list schemas", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await client.listSchemas();

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/schemas`,
        expect.objectContaining({
          method: "GET",
        })
      );
    });
  });

  describe("Attestations", () => {
    it("should create an attestation", async () => {
      const mockAttestation: Attestation = {
        claim: "has_memories_matching",
        params: { query: "recipes", filters: { agentId: "recipe-bot" } },
        result: { satisfied: true, matchCount: 5, namespace: "0x123" },
        issuedAt: 1703123456,
        expiresAt: 1703209856,
        issuer: "zkstash.ai",
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          attestation: mockAttestation,
          signature: "0xsig123",
          publicKey: "zkstash.ai",
        }),
      });

      const result = await client.createAttestation({
        claim: "has_memories_matching",
        query: "recipes",
        filters: { agentId: "recipe-bot" },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/attestations`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            claim: "has_memories_matching",
            query: "recipes",
            filters: { agentId: "recipe-bot" },
          }),
        })
      );
      expect(result.attestation.result.satisfied).toBe(true);
      expect(result.signature).toBe("0xsig123");
    });

    it("should create attestation with threshold", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          attestation: {
            claim: "memory_count_gte",
            params: { threshold: 10 },
            result: { satisfied: true, matchCount: 15, namespace: "0x123" },
            issuedAt: 1703123456,
            expiresAt: 1703209856,
            issuer: "zkstash.ai",
          },
          signature: "0xsig456",
          publicKey: "zkstash.ai",
        }),
      });

      const result = await client.createAttestation({
        claim: "memory_count_gte",
        threshold: 10,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/attestations`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            claim: "memory_count_gte",
            threshold: 10,
          }),
        })
      );
      expect(result.attestation.result.matchCount).toBe(15);
    });

    it("should verify an attestation locally", async () => {
      // Future timestamp so attestation is not expired
      const futureExpiry = Math.floor(Date.now() / 1000) + 86400;
      const attestation: Attestation = {
        claim: "has_memories_matching",
        params: { query: "recipes" },
        result: { satisfied: true, matchCount: 5, namespace: "0x123" },
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: futureExpiry,
        issuer: "zkstash.ai",
      };

      // Mock the well-known endpoint to return a public key
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          attestationPublicKey: "0x" + "ab".repeat(32), // Mock 32-byte public key
          algorithm: "Ed25519",
        }),
      });

      // Use a fake signature - it will fail verification but we're testing the flow
      const result = await client.verifyAttestation(
        attestation,
        "0x" + "cd".repeat(64)
      );

      // Should have fetched the public key from well-known endpoint
      expect(fetchMock).toHaveBeenCalledWith(
        `https://zkstash.ai/.well-known/zkstash-keys.json`
      );
      // Signature won't match since it's fake, but the flow should work
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("should return invalid for expired attestation", async () => {
      const attestation: Attestation = {
        claim: "has_memories_matching",
        params: { query: "recipes" },
        result: { satisfied: true, matchCount: 5, namespace: "0x123" },
        issuedAt: 1703123456,
        expiresAt: 1703123456, // Already expired (in the past)
        issuer: "zkstash.ai",
      };

      // Local verification checks expiry first, no API call needed
      const result = await client.verifyAttestation(attestation, "0xsig123");

      // Should NOT have made any fetch calls - expiry check happens first
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("attestation_expired");
    });
  });

  describe("Error Handling", () => {
    it("should throw on API error", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "Invalid payload",
      });

      await expect(
        client.createMemory({
          agentId: "agent_1",
          conversation: [],
        })
      ).rejects.toThrow("API error (400 Bad Request): Invalid payload");
    });
  });
});
