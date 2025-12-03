import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSigner, type Signer } from "x402-fetch";
import type { MessagePartialSigner } from "@solana/kit";
import type { Signer as EvmSigner } from "ethers";
import type { PaymentConfig } from "./client.js";
import { createHash } from "crypto";

// Import createPaymentHeader directly from x402 modules
import { createPaymentHeader } from "x402/client";
import type { PaymentRequirements } from "x402/types";

export interface McpClientOptions {
  agentId: string;
  threadId?: string;
  maxValue?: bigint;
  paymentConfig?: Omit<PaymentConfig, "signer" | "maxValue">;
}

/**
 * Create an MCP client from a private key.
 * Follows the same pattern as the REST client for API coherence.
 * Works with both EVM and Solana chains.
 * Includes automatic x402 payment handling for paid MCP tools.
 * 
 * @example
 * ```typescript
 * import * as MCP from "@zkstash/sdk/mcp";
 * 
 * const mcpClient = await MCP.fromPrivateKey(
 *   "solana-devnet",
 *   "your-private-key",
 *   {
 *     agentId: "my-agent",
 *     threadId: "my-thread", // optional
 *     maxValue: BigInt(0.1 * 10 ** 6), // 0.1 USDC
 *   }
 * );
 * 
 * // Use with LangChain
 * const tools = await mcpClient.getTools();
 * ```
 * 
 * @param chain - The blockchain network (e.g., "solana-devnet", "solana", "base", "ethereum")
 * @param mcpUrl - The full MCP endpoint URL (e.g., "https://zkstash.ai/mcp")
 * @param privateKey - The wallet private key for auth and payments
 * @param options - Additional configuration (agentId is required)
 * @returns MCP Client instance ready to use with x402 payment support
 */
export async function fromPrivateKey(
  chain: string,
  mcpUrl: string = 'https://zkstash.ai/mcp',
  privateKey: string,
  options: McpClientOptions
): Promise<Client> {
  const {
    agentId,
    threadId,
    maxValue,
    paymentConfig,
  } = options;

  if (!agentId) {
    throw new Error("agentId is required for MCP client");
  }

  // Create signer for both auth and payment
  const signer = await createSigner(chain, privateKey);
  const { address } = signer as { address: string };
  const maxPayment = maxValue ?? BigInt(0.1 * 10 ** 6);

  // Helper to sign requests (supports both EVM and Solana)
  const signRequest = async (url: URL, method: string, body: string) => {
    const timestamp = Date.now().toString();
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const canonical = [method.toUpperCase(), url.pathname, bodyHash, timestamp].join("|");

    // Check if signer is EVM or Solana based on address format
    const signature = address.startsWith("0x")
      ? await signWithEvm(signer, canonical)
      : await signWithSolana(signer, canonical);

    return {
      "x-wallet-address": address,
      "x-wallet-timestamp": timestamp,
      "x-wallet-signature": signature,
      "x-agent-id": agentId,
      ...(threadId && { "x-thread-id": threadId }),
    };
  };

  // Create transport with auth headers
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: async (url: RequestInfo | URL, opts?: RequestInit) => {
      const method = opts?.method || "POST";
      const body = opts?.body?.toString() || "";

      const urlObj = typeof url === "string" ? new URL(url) :
        url instanceof URL ? url : new URL(url.url);

      // Sign the request for authentication
      const authHeaders = await signRequest(urlObj, method, body);

      // Merge auth headers
      const headers = new Headers(opts?.headers || {});
      Object.entries(authHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      // Use standard fetch with auth headers
      return (paymentConfig?.fetch ?? globalThis.fetch)(url as RequestInfo, { ...opts, headers });
    },
  });

  // Create base client
  const client = new Client(
    {
      name: "zkstash-sdk-mcp",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  await client.connect(transport);

  // Wrap callTool to handle x402 payments
  const originalCallTool = client.callTool.bind(client);

  client.callTool = async function (params: any, resultSchema?: any, options?: any) {
    // First attempt: call tool without payment
    let result = await originalCallTool(params, resultSchema, options);

    // Check if payment is required (402 response with payment requirements)
    const x402Error = result._meta?.["x402/error"] as
      | { accepts: PaymentRequirements[]; error?: string }
      | undefined;

    if (
      result.isError &&
      x402Error &&
      x402Error.accepts &&
      Array.isArray(x402Error.accepts) &&
      x402Error.accepts.length > 0
    ) {
      const accepts = x402Error.accepts;

      // Pick payment requirement that matches our network
      const paymentRequirementsSelector = paymentConfig?.paymentRequirementsSelector ??
        ((requirements: PaymentRequirements[]) => {
          const r = requirements.find((pr) => pr.network === chain);
          return r || requirements[0];
        });

      const req = paymentRequirementsSelector(accepts);

      if (!req || req.scheme !== "exact") {
        return result; // Can't handle non-exact schemes
      }

      const requiredAmount = BigInt(req.maxAmountRequired);
      if (requiredAmount > maxPayment) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Payment required (${requiredAmount}) exceeds maximum allowed (${maxPayment})`
          }]
        };
      }

      // Generate payment header
      const paymentHeader = await createPaymentHeader(
        signer as any, // x402 types will handle EVM/Solana
        1, // x402 version
        req
      );

      // Retry with payment in _meta
      result = await originalCallTool(
        {
          ...params,
          _meta: {
            ...params._meta,
            "x402/payment": paymentHeader
          }
        },
        resultSchema,
        options
      );
    }

    return result;
  };

  return client;
}

// Signing helpers (same as REST client)
async function signWithEvm(signer: Signer, message: string) {
  const s = signer as unknown as EvmSigner;
  return s.signMessage(message);
}

async function signWithSolana(signer: Signer, message: string) {
  const s = signer as unknown as MessagePartialSigner;
  const address = s.address;

  const { createSignableMessage } = await import("@solana/kit");
  const signableMessage = createSignableMessage(message);
  const [signedMessage] = await s.signMessages([signableMessage]);

  return Buffer.from(signedMessage[address]).toString("base64");
}
