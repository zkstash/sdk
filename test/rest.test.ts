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
            "Authorization": `Bearer ${apiKey}`,
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
        expect.stringContaining(`${baseUrl}/memories/search?query=test&agentId=agent_1`),
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
        json: async () => ([]),
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

  describe("Error Handling", () => {
    it("should throw on API error", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "Invalid payload",
      });

      await expect(client.createMemory({
        agentId: "agent_1",
        conversation: [],
      })).rejects.toThrow("API error (400 Bad Request): Invalid payload");
    });
  });
});
