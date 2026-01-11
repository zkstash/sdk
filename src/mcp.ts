import { createHash } from "crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { type Signer as X402Signer } from "x402-fetch";

import { signWithEvm, signWithSolana, signerFromPrivateKey } from "./utils.js";

// Import createPaymentHeader directly from x402 modules
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import {
  evm,
  Network,
  PaymentRequirements,
  ChainIdToNetwork,
} from "x402/types";

import type {
  McpFromPrivateKeyOptions,
  McpFromApiKeyOptions,
} from "./types.js";

/**
 * Create an MCP client from a private key.
 * Follows the same pattern as the REST client for API coherence.
 * Works with both EVM and Solana chains.
 * Includes automatic x402 payment handling for paid MCP tools.
 *
 * @example
 * ```typescript
 * import { fromPrivateKey } from "@zkstash/sdk/mcp";
 *
 * const mcpClient = await fromPrivateKey(
 *   "solana-devnet",
 *   "your-private-key",
 *   {
 *     agentId: "my-agent",
 *     subjectId: "my-subject", // optional
 *     threadId: "my-thread", // optional
 *     payment: {
 *       maxValue: BigInt(0.1 * 10 ** 6), // 0.1 USDC
 *     },
 *   }
 * );
 *
 * // Use with LangChain
 * const tools = await mcpClient.getTools();
 * ```
 *
 * @param privateKey - The wallet private key for auth and payments
 * @param options - Configuration (chain and agentId are required)
 * @returns MCP Client instance ready to use with x402 payment support
 */
export async function fromPrivateKey(
  privateKey: string,
  options: McpFromPrivateKeyOptions
): Promise<Client> {
  const signer = await signerFromPrivateKey(privateKey);

  return fromSigner(signer, {
    ...options,
    payment: {
      signer, // Use the same signer for payment by default
      ...options.payment,
    },
  });
}

/**
 * Create an MCP client from an existing signer.
 * Advanced: Use this when you need separate signers for authentication and payment.
 *
 * @example
 * ```typescript
 * import { fromSigner } from "@zkstash/sdk/mcp";
 * import { createSigner } from "x402-fetch";
 *
 * const authSigner = await createSigner("ethereum", "0xAUTH_KEY");
 * const paymentSigner = await createSigner("base", "0xPAYMENT_KEY");
 *
 * const mcpClient = await fromSigner(
 *   "ethereum",  // chain for auth signer
 *   authSigner,
 *   {
 *     agentId: "my-agent",
 *     subjectId: "tenant-a", // optional
 *     threadId: "my-thread", // optional
 *     payment: {
 *       signer: paymentSigner,
 *       maxValue: BigInt(0.1 * 10 ** 6),
 *     }
 *   }
 * );
 * ```
 *
 * @param signer - The x402 signer to use for authentication
 * @param options - Configuration (agentId is required, can include separate payment signer)
 * @returns MCP Client instance ready to use with x402 payment support
 */
export async function fromSigner(
  signer: X402Signer,
  options: McpFromPrivateKeyOptions & {
    payment?: {
      signer?: X402Signer;
      maxValue?: bigint;
      paymentRequirementsSelector?: (
        requirements: PaymentRequirements[]
      ) => PaymentRequirements;
      fetch?: typeof fetch;
    };
  }
): Promise<Client> {
  const {
    agentId,
    subjectId,
    threadId,
    payment,
    mcpUrl = "https://zkstash.ai/mcp",
  } = options;

  if (!agentId) {
    throw new Error("agentId is required for MCP client");
  }

  const { address } = signer as { address: string };
  const paymentSigner = payment?.signer ?? signer; // Default to auth signer if not provided
  const maxPayment = payment?.maxValue ?? BigInt(0.1 * 10 ** 6);

  // Helper to sign requests (supports both EVM and Solana)
  const signRequest = async (url: URL, method: string, body: string) => {
    const timestamp = Date.now().toString();
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const canonical = [
      method.toUpperCase(),
      url.pathname,
      bodyHash,
      timestamp,
    ].join("|");

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
      ...(subjectId && { "x-subject-id": subjectId }),
    };
  };

  // Create transport with auth headers
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: async (url: RequestInfo | URL, opts?: RequestInit) => {
      const method = opts?.method || "POST";
      const body = opts?.body?.toString() || "";

      const urlObj =
        typeof url === "string"
          ? new URL(url)
          : url instanceof URL
          ? url
          : new URL(url.url);

      // Sign the request for authentication
      const authHeaders = await signRequest(urlObj, method, body);

      // Merge auth headers
      const headers = new Headers(opts?.headers || {});
      Object.entries(authHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      // Use standard fetch with auth headers
      return (payment?.fetch ?? globalThis.fetch)(url as RequestInfo, {
        ...opts,
        headers,
      });
    },
  });

  // Create base client
  const client = new Client(
    {
      name: "zkstash-sdk-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  // Wrap callTool to handle x402 payments
  const originalCallTool = client.callTool.bind(client);

  client.callTool = async function (
    params: any,
    resultSchema?: any,
    options?: any
  ) {
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

      // Check if signer is an EVM or Solana
      const { address } = paymentSigner as { address: string };
      const network = address.startsWith("0x")
        ? ChainIdToNetwork[(paymentSigner as typeof evm.EvmSigner).chain?.id]
        : (["solana", "solana-devnet"] as Network[]);

      const paymentRequirements = selectPaymentRequirements(accepts, network);

      if (!paymentRequirements || paymentRequirements.scheme !== "exact") {
        return result; // Can't handle non-exact schemes
      }

      const requiredAmount = BigInt(paymentRequirements.maxAmountRequired);
      if (requiredAmount > maxPayment) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Payment required (${requiredAmount}) exceeds maximum allowed (${maxPayment})`,
            },
          ],
        };
      }

      // Generate payment header using the payment signer
      const paymentHeader = await createPaymentHeader(
        paymentSigner, // x402 types will handle EVM/Solana
        1, // x402 version
        paymentRequirements
      );

      // Retry with payment in _meta
      result = await originalCallTool(
        {
          ...params,
          _meta: {
            ...params._meta,
            "x402/payment": paymentHeader,
          },
        },
        resultSchema,
        options
      );
    }

    return result;
  };

  return client;
}

/**
 * Create an MCP client from an API key.
 * Bypasses x402 payment logic.
 *
 * @example
 * ```typescript
 * import { fromApiKey } from "@zkstash/sdk/mcp";
 *
 * const mcpClient = await fromApiKey(
 *   "zk_...",
 *   {
 *     agentId: "my-agent",
 *     subjectId: "tenant-a" // optional
 *   }
 * );
 * ```
 *
 * @param apiKey - The API key
 * @param options - Configuration (agentId is required)
 * @returns MCP Client instance
 */
export async function fromApiKey(
  apiKey: string,
  options: McpFromApiKeyOptions
): Promise<Client> {
  const {
    agentId,
    subjectId,
    threadId,
    mcpUrl = "https://zkstash.ai/mcp",
  } = options;

  if (!agentId) {
    throw new Error("agentId is required for MCP client");
  }

  // Create transport with auth headers
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: async (url: RequestInfo | URL, opts?: RequestInit) => {
      const headers = new Headers(opts?.headers || {});
      headers.set("Authorization", `Bearer ${apiKey}`);
      headers.set("x-agent-id", agentId);
      if (subjectId) {
        headers.set("x-subject-id", subjectId);
      }
      if (threadId) {
        headers.set("x-thread-id", threadId);
      }

      return globalThis.fetch(url as RequestInfo, { ...opts, headers });
    },
  });

  // Create base client
  const client = new Client(
    {
      name: "zkstash-sdk-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return client;
}
