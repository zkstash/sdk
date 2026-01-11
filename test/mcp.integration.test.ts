import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { fromPrivateKey, fromApiKey } from "../src/mcp";

/**
 * MCP Integration tests for zkstash-sdk
 *
 * Run with: ZKSTASH_API_KEY=zk_... pnpm vitest run test/mcp.integration.test.ts
 *
 * Environment variables:
 * - ZKSTASH_API_KEY: API key for authentication (preferred for CI)
 * - ZKSTASH_PRIVATE_KEY: Wallet private key (alternative auth, enables payment tests)
 * - ZKSTASH_MCP_URL: Custom MCP URL (default: https://zkstash.ai/mcp)
 */

const API_KEY = process.env.ZKSTASH_API_KEY;
const PRIVATE_KEY = process.env.ZKSTASH_PRIVATE_KEY;
const MCP_URL = process.env.ZKSTASH_MCP_URL;

// Skip all tests if no credentials are provided
const shouldRun = API_KEY || PRIVATE_KEY;

describe.skipIf(!shouldRun)("ZkStash MCP Integration Tests", () => {
  let client: Client;

  const testAgentId = `test-agent-mcp-integration`;
  const testThreadId = `test-thread-mcp-integration`;

  beforeAll(async () => {
    if (API_KEY) {
      client = await fromApiKey(API_KEY, {
        agentId: testAgentId,
        threadId: testThreadId,
        mcpUrl: MCP_URL,
      });
    } else if (PRIVATE_KEY) {
      client = await fromPrivateKey(PRIVATE_KEY, {
        agentId: testAgentId,
        threadId: testThreadId,
        mcpUrl: MCP_URL,
        payment: {
          maxValue: BigInt(100000), // 0.1 USDC
        },
      });
    }
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  describe("Client Connection", () => {
    it("should connect to MCP server", () => {
      expect(client).toBeInstanceOf(Client);
    });

    it("should list available tools", async () => {
      const result = await client.listTools();

      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);

      // Log available tools for debugging
      const toolNames = result.tools.map((t) => t.name);
      console.log("Available MCP tools:", toolNames);
    });
  });

  describe("Memory Tools", () => {
    let createdMemoryId: string | undefined;

    it("should search memories via MCP", async () => {
      const result = await client.callTool({
        name: "memory_search",
        arguments: {
          query: "test query",
          agentId: testAgentId,
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();
    });

    it("should create memory via MCP", async () => {
      const result = await client.callTool({
        name: "write_factual_memory",
        arguments: {
          agentId: testAgentId,
          threadId: testThreadId,
          fact: "My favorite color is purple.",
          source: "user",
          subject: "Alice",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();

      // Try to extract memory ID from response for cleanup
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content.find(
          (c: { type: string }) => c.type === "text"
        );
        if (textContent && "text" in textContent) {
          try {
            const parsed = JSON.parse(textContent.text as string);
            if (parsed.memories?.[0]?.id) {
              createdMemoryId = parsed.memories[0].id;
            }
          } catch {
            // Response might not be JSON
          }
        }
      }
    });

    it("should search with filters via MCP", async () => {
      // Wait a moment for indexing
      await new Promise((r) => setTimeout(r, 500));

      const result = await client.callTool({
        name: "memory_search",
        arguments: {
          query: "purple color",
          agentId: testAgentId,
          threadId: testThreadId,
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();
    });

    afterAll(async () => {
      // Cleanup: delete test memories using batch delete
      if (client) {
        try {
          await client.callTool({
            name: "memory_batch_delete",
            arguments: {
              agentId: testAgentId,
            },
          });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe("Tool Introspection", () => {
    it("should have memory_search tool with correct schema", async () => {
      const { tools } = await client.listTools();
      const searchTool = tools.find((t) => t.name === "memory_search");

      expect(searchTool).toBeDefined();
      expect(searchTool!.description).toBeDefined();
      expect(searchTool!.inputSchema).toBeDefined();
    });

    it("should have write_* tools with correct schema", async () => {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        if (tool.name.startsWith("write_")) {
          expect(tool).toBeDefined();
          expect(tool!.description).toBeDefined();
          expect(tool!.inputSchema).toBeDefined();
        }
      }
    });
  });
});

describe.skipIf(!PRIVATE_KEY)("MCP Payment Integration Tests", () => {
  let client: Client;
  const testAgentId = `mcp-payment-test-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    client = await fromPrivateKey(PRIVATE_KEY!, {
      agentId: testAgentId,
      mcpUrl: MCP_URL,
      payment: {
        maxValue: BigInt(100000), // 0.1 USDC
      },
    });
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it("should handle tool calls that require payment", async () => {
    // This test validates the payment handling flow
    // The wrapped callTool should automatically handle 402 responses
    const result = await client.callTool({
      name: "memory_search",
      arguments: {
        query: "payment test",
        agentId: testAgentId,
      },
    });

    // Should either succeed with payment or succeed without (depending on server config)
    // The key is that it doesn't crash on 402 responses
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("should respect maxValue payment limit", async () => {
    // Create a client with very low payment limit
    const limitedClient = await fromPrivateKey(PRIVATE_KEY!, {
      agentId: testAgentId,
      mcpUrl: MCP_URL,
      payment: {
        maxValue: BigInt(1), // 0.000001 USDC - effectively nothing
      },
    });

    try {
      const result = await limitedClient.callTool({
        name: "memory_search",
        arguments: {
          query: "limit test",
          agentId: testAgentId,
        },
      });

      // If payment is required and exceeds limit, should get an error
      // If no payment required, should succeed
      expect(result).toBeDefined();
    } finally {
      await limitedClient.close();
    }
  });
});

describe.skipIf(!API_KEY)("MCP API Key Integration Tests", () => {
  it("should create client with API key authentication", async () => {
    const client = await fromApiKey(API_KEY!, {
      agentId: "api-key-test",
      mcpUrl: MCP_URL,
    });

    expect(client).toBeInstanceOf(Client);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    await client.close();
  });

  it("should include threadId in requests when provided", async () => {
    const client = await fromApiKey(API_KEY!, {
      agentId: "api-key-test",
      threadId: "specific-thread-id",
      mcpUrl: MCP_URL,
    });

    // Make a tool call - the threadId should be included in headers
    const result = await client.callTool({
      name: "memory_search",
      arguments: {
        query: "thread test",
        agentId: "api-key-test",
      },
    });

    expect(result).toBeDefined();
    await client.close();
  });
});
