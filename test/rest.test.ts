import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZkStash, fromApiKey } from "../src/rest";

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

      const payload = {
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

    it("should verify memory integrity", async () => {
      const mockResponse = {
        success: true,
        memoryId: "mem_123",
        integrity: {
          intact: true,
          storedHash: "0xabc123",
          computedHash: "0xabc123",
          verifiedAt: 1703123456789,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.verifyMemory("mem_123");

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/memories/mem_123/verify`,
        expect.objectContaining({
          method: "GET",
        })
      );
      expect(result.integrity.intact).toBe(true);
      expect(result.integrity.storedHash).toBe("0xabc123");
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
        cardinality: "single",
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
      const mockAttestation = {
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

    it("should verify an attestation", async () => {
      const attestation = {
        claim: "has_memories_matching" as const,
        params: { query: "recipes" },
        result: { satisfied: true, matchCount: 5, namespace: "0x123" },
        issuedAt: 1703123456,
        expiresAt: 1703209856,
        issuer: "zkstash.ai" as const,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          valid: true,
          reason: null,
          attestation,
          publicKey: "zkstash.ai",
        }),
      });

      const result = await client.verifyAttestation(attestation, "0xsig123");

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/attestations/verify`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            attestation,
            signature: "0xsig123",
          }),
        })
      );
      expect(result.valid).toBe(true);
    });

    it("should return invalid for expired attestation", async () => {
      const attestation = {
        claim: "has_memories_matching" as const,
        params: { query: "recipes" },
        result: { satisfied: true, matchCount: 5, namespace: "0x123" },
        issuedAt: 1703123456,
        expiresAt: 1703123456, // Already expired
        issuer: "zkstash.ai" as const,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          valid: false,
          reason: "attestation_expired",
          attestation: null,
          publicKey: "zkstash.ai",
        }),
      });

      const result = await client.verifyAttestation(attestation, "0xsig123");

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
