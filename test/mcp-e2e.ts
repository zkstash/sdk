import * as MCP from "../src/mcp.js";

const TEST_PRIVATE_KEY =
  "2XWcxyPwThSovVeZWmS5wkh7qYKUvXtftmr89X78UpbPuAut873o9FPgfhQwtQEuWSDNaqGo8Nbe2MHafC9V7vsh";
const MCP_URL = "http://localhost:3000/mcp";

async function main() {
  // Create MCP client using the helper - much simpler!
  const client = await MCP.fromPrivateKey(
    "solana-devnet",
    MCP_URL,  // Full MCP endpoint URL
    TEST_PRIVATE_KEY,
    {
      agentId: "test_agent",
      threadId: "test_thread",
      maxValue: BigInt(0.1 * 10 ** 6), // 0.1 USDC
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
