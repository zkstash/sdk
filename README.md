# ZKStash SDK

TypeScript SDK for https://zkstash.ai - Long Term Memory Management for AI agents.

## Installation

```bash
npm install @zkstash/sdk
```

## Quick start

If you just need a ready-to-go client and are fine using the same private key
for both ZKStash auth and x402 payments, use `fromPrivateKey`:

```ts
import { fromPrivateKey } from "@zkstash/sdk/rest";

async function main() {
  const client = await fromPrivateKey(process.env.PRIVATE_KEY as `0x${string}`);

  await client.createMemory({
    userId: "user_demo",
    agentId: "agent_demo",
    conversation: [
      { role: "user", content: "Met Alex for coffee in SF." },
      { role: "assistant", content: "Great, logging it." },
    ],
  });
}
```

## MCP Client

The SDK includes a Model Context Protocol (MCP) client.

```ts
import { fromPrivateKey } from "@zkstash/sdk/mcp";

async function main() {
  const client = await fromPrivateKey(process.env.PRIVATE_KEY!, {
    agentId: "agent_demo",
    payment: {
      maxValue: 10000n, // Optional payment cap
    },
  });

  // List available tools
  const tools = await client.listTools();
  console.log(tools);

  // Call a tool
  const result = await client.callTool({
    name: "memory_search",
    arguments: {
      query: "test query",
      agentId: "agent_demo",
    },
  });
  console.log(result);
}
```

## Advanced usage (custom wallets)

To use different keys for auth and payments (recommended), build your own
signers via `x402-fetch` and pass them to the `ZkStash` constructor.

### EVM

```ts
import { createSigner } from "x402-fetch";
import { ZkStash } from "@zkstash/sdk/rest";

const authSigner = await createSigner("base-sepolia", process.env.AGENT_KEY!);
const paymentSigner = await createSigner("base-sepolia", process.env.X402_KEY!);

const client = new ZkStash({
  signer: authSigner,
  payment: {
    signer: paymentSigner,
    maxValue: 5_000n,
  },
});
```

### Solana

```ts
import { createSigner } from "x402-fetch";
import { ZkStash } from "@zkstash/sdk/rest";

const authSigner = await createSigner("solana-devnet", process.env.AGENT_KEY!);
const paymentSigner = await createSigner(
  "solana-devnet",
  process.env.X402_KEY!
);

const client = new ZkStash({
  signer: authSigner,
  payment: {
    signer: paymentSigner,
  },
});
```

Once the client is created you can call any endpoint:

```ts
const memories = await client.searchMemories({
  query: "coffee",
  filters: { userId: "user_demo", agentId: "agent_demo" },
});

console.log(memories);
```

## Development

### Testing

To run the E2E tests, you need to set the `TEST_PRIVATE_KEY` environment variable.

```bash
# Run REST client E2E test
TEST_PRIVATE_KEY=your_private_key npm run e2e

# Run MCP client E2E test (requires local MCP server)
TEST_PRIVATE_KEY=your_private_key npm run mcp-e2e
```
