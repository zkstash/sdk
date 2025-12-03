import { fromPrivateKey } from "../src/mcp.js";

const TEST_PRIVATE_KEY = '';
const MCP_URL = "http://localhost:3000/mcp";

async function main() {
  // Create MCP client using the helper - much simpler!
  const client = await fromPrivateKey(
    TEST_PRIVATE_KEY,
    {
      agentId: "test_agent",
      threadId: "test_thread",
      mcpUrl: MCP_URL,  // Full MCP endpoint URL
      payment: {
        maxValue: 100000n, // 0.1 USDC
      }
    }
  );

  try {
    // List available tools
    const toolsResult = await client.listTools();
    console.log("Available tools:", toolsResult.tools.map((t) => t.name));

    // Test search_memories tool
    const searchResult = await client.callTool({
      name: "memory_search",
      arguments: {
        query: "test query",
        agentId: "test_agent",
      },
    });
    console.log("Search result:", searchResult);

    console.log("✅ MCP E2E test completed successfully!");
  } catch (error) {
    console.error("❌ MCP E2E test failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
