# API

## Quick start

If you just need a ready-to-go client and are fine using the same private key
for both Degentics auth and x402 payments, use `fromPrivateKey`:

```ts
import { fromPrivateKey } from "@degentics/memory-sdk";

async function main() {
  const client = await fromPrivateKey(
    "base-sepolia",
    "https://api.degentics.ai",
    process.env.PRIVATE_KEY as `0x${string}`,
    {
      maxValue: 5_000n, // optional payment cap in base units
    }
  );

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

## Advanced usage (custom wallets)

To use different keys for auth and payments (recommended), build your own
signers via `x402-fetch` and pass them to the `MemoryClient` constructor.

### EVM

```ts
import { createSigner } from "x402-fetch";
import { MemoryClient } from "@degentics/memory-sdk";

const authSigner = await createSigner("base-sepolia", process.env.AGENT_KEY!);
const paymentSigner = await createSigner("base-sepolia", process.env.X402_KEY!);

const client = new MemoryClient({
  baseUrl: "https://api.degentics.ai",
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
import { MemoryClient } from "@degentics/memory-sdk";

const authSigner = await createSigner("solana-devnet", process.env.AGENT_KEY!);
const paymentSigner = await createSigner(
  "solana-devnet",
  process.env.X402_KEY!
);

const client = new MemoryClient({
  baseUrl: "https://api.degentics.ai",
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
