import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fromApiKey, fromPrivateKey } from "../src/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock dependencies if needed, but we can rely on mocking fetch passed to transport
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

describe("ZkStash MCP Client", () => {
  const apiKey = "zk_test_key";
  const agentId = "agent_1";

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("fromApiKey", () => {
    it("should create a client with API key auth", async () => {
      // Mock the connection handshake
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => "", // SSE handshake usually keeps connection open, but for client connect it might just need a response
        // The SDK might expect a specific response or just a successful connection.
        // StreamableHTTPClientTransport uses EventSource or fetch.
        // If it uses fetch for polling/stream, we need to be careful.
        // Actually, StreamableHTTPClientTransport uses fetch for POST requests (JSON-RPC).
        // It might use SSE for receiving?
        // Let's look at how we can test this without full network mock.
        // We can just check if the client is returned and has the right properties.
      });

      // We can't easily mock the internal connection logic of MCP SDK without more complex mocks.
      // However, we can test that the factory function returns a Client.

      // We need to mock Client.connect to avoid actual network call during test if we don't want to mock transport internals.
      const connectSpy = vi
        .spyOn(Client.prototype, "connect")
        .mockResolvedValue(undefined);

      const client = await fromApiKey(apiKey, { agentId });

      expect(client).toBeInstanceOf(Client);
      expect(connectSpy).toHaveBeenCalled();
    });
  });

  describe("fromPrivateKey", () => {
    it("should create a client with wallet auth", async () => {
      const connectSpy = vi
        .spyOn(Client.prototype, "connect")
        .mockResolvedValue(undefined);
      const pk =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat default

      const client = await fromPrivateKey(pk, { agentId });

      expect(client).toBeInstanceOf(Client);
      expect(connectSpy).toHaveBeenCalled();
    });
  });
});
