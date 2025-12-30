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
  filters: { agentId: "agent_demo" },
});

console.log(memories);
```

## Memory TTL (Time-to-Live)

Memories can have an optional expiry time. Expired memories are automatically cleaned up.

### Creating Memories with TTL

```ts
// Per-memory TTL
await client.storeMemories("agent-1", [
  { kind: "SessionContext", data: { task: "booking" }, ttl: "24h" },
  { kind: "Reminder", data: { text: "Follow up" }, ttl: "1h" },
]);

// Default TTL for all memories in request
await client.storeMemories(
  "agent-1",
  [
    { kind: "SessionContext", data: { task: "booking" } },
    { kind: "Preference", data: { color: "blue" } },
  ],
  { ttl: "7d" }
);

// Using explicit timestamp
await client.storeMemories("agent-1", [
  {
    kind: "Meeting",
    data: { title: "Sync" },
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  },
]);
```

### Updating Memory Expiry

```ts
// Set new expiry
await client.updateMemory("mem_abc123", {
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days from now
});

// Remove expiry (make permanent)
await client.updateMemory("mem_abc123", {
  expiresAt: null,
});
```

## Batch Operations

For better performance with multiple memories, use batch operations.

### Batch Search

```ts
const results = await client.batchSearchMemories([
  { query: "user preferences", filters: { agentId: "assistant" } },
  { query: "recent tasks", filters: { agentId: "assistant" } },
  { query: "meeting notes", filters: { agentId: "assistant" } },
]);

// results.results[0].memories - first query results
// results.results[1].memories - second query results
```

### Batch Delete

```ts
const result = await client.batchDeleteMemories([
  "mem_abc123",
  "mem_def456",
  "mem_ghi789",
]);
console.log(`Deleted ${result.deleted} memories`);
```

### Batch Update

```ts
// Tag multiple memories
await client.batchUpdateMemories(
  ["mem_abc123", "mem_def456"],
  { tags: ["archived", "q4-2024"] }
);

// Set expiry on multiple memories
await client.batchUpdateMemories(
  ["mem_abc123", "mem_def456"],
  { expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }
);
```

## Memory Sharing with Grants

ZKStash supports permissionless memory sharing between agents using cryptographic grants. A grant is a signed message that allows one agent to access another agent's memories.

### Creating a Grant

```ts
import { fromPrivateKey } from "@zkstash/sdk/rest";

// Agent A creates a grant for Agent B
const agentA = await fromPrivateKey(process.env.AGENT_A_KEY!);

const { grant, shareCode } = await agentA.createGrant({
  grantee: "0x...", // Agent B's wallet address (or Clerk userId for API key users)
  agentId: "researcher", // Optional: limit to specific agent
  duration: "7d", // Grant lasts 7 days (e.g., "1h", "24h", "30d")
});

// Share the code with Agent B (via any channel)
console.log("Share this code:", shareCode);
```

> **Note**: For API key users, use their Clerk userId (e.g., `user_2abc123...`) as the grantee. This is displayed in the zkStash dashboard.

### Using a Grant

```ts
import { fromPrivateKey } from "@zkstash/sdk/rest";

// Agent B receives the share code and adds it
const agentB = await fromPrivateKey(process.env.AGENT_B_KEY!);

// Add grant for automatic inclusion in all searches
agentB.addGrant(shareCode);

// Now searches will include Agent A's shared memories
const results = await agentB.searchMemories({
  query: "research findings",
  filters: { agentId: "researcher" },
});

// Results include source annotations
results.memories.forEach((m) => {
  if (m.source === "shared") {
    console.log(`From ${m.grantor}:`, m.data);
  }
});
```

### Search Scopes

Control which memories to search using the `scope` option:

```ts
// Search only your own memories (ignores grants)
await client.searchMemories(
  { query: "preferences", filters: { agentId: "my-agent" } },
  { scope: "own" }
);

// Search only shared memories (from grants)
await client.searchMemories(
  { query: "findings", filters: { agentId: "researcher" } },
  { grants: [grantFromResearcher], scope: "shared" }
);

// Search both own + shared (default)
await client.searchMemories(
  { query: "everything", filters: { agentId: "any" } },
  { grants: [grantFromA] } // scope defaults to "all"
);
```

### Grant Management

```ts
// Add a grant (accepts SignedGrant object or share code string)
client.addGrant(shareCode);
client.addGrant(grantObject);

// Remove a grant
client.removeGrant(grantObject);

// Get all instance grants
const grants = client.getInstanceGrants();

// Pass grants per-request without storing them
await client.searchMemories(
  { query: "...", filters: { agentId: "..." } },
  { grants: [oneTimeGrant] }
);
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
