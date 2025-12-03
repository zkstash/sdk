import { createHash } from "crypto";

import { Signer as EvmSigner } from "ethers";
import { createSignableMessage, MessagePartialSigner } from "@solana/kit";
import { z } from "zod";

import {
  createSigner,
  wrapFetchWithPayment,
  type X402Config,
  type Signer as X402Signer,
  type PaymentRequirementsSelector,
  type MultiNetworkSigner as X402MultiNetworkSigner,
} from "x402-fetch";

// ------------------------------

type CreateMemoryPayload = {
  agentId: string;
  threadId?: string;
  schemas?: string[];
  conversation: { role: string; content: string }[];
};

type SearchMemoriesPayload = {
  query: string;
  filters: {
    agentId: string;
    threadId?: string;
    kind?: string;
    tags?: string[];
  };
  mode?: "raw" | "answer" | "map";
};

type CreateSchemaPayload = {
  name: string;
  description: string;
  cardinality: "single" | "multiple";
  schema: string | z.ZodTypeAny; // JSON string or Zod schema
};

// ---

export type PaymentConfig = {
  signer: X402Signer | X402MultiNetworkSigner;
  maxValue?: bigint;
  paymentRequirementsSelector?: PaymentRequirementsSelector;
  x402Config?: X402Config;
  fetch?: typeof fetch;
};

export type MemoryClientOptions = {
  baseUrl: string;
  signer: X402Signer;
  payment: PaymentConfig;
};

type FetchLike = typeof globalThis.fetch;

export class MemoryClient {
  private readonly baseUrl: string;
  private readonly signer: X402Signer;
  private readonly fetchFn: FetchLike;

  constructor(opts: MemoryClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.signer = opts.signer;

    const fetchImpl = opts.payment.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error(
        "No fetch implementation available. Provide global fetch or payment.fetch."
      );
    }

    const wrappedFetch = wrapFetchWithPayment(
      fetchImpl,
      opts.payment.signer,
      opts.payment.maxValue,
      opts.payment.paymentRequirementsSelector,
      opts.payment.x402Config
    ) as FetchLike;

    this.fetchFn = wrappedFetch;
  }

  // ----- public high-level APIs -----

  createMemory(payload: CreateMemoryPayload) {
    return this.request("/memories", {
      method: "POST",
      body: payload,
    });
  }

  deleteMemory(params: { id: string }) {
    return this.request(`/memories/${params.id}`, {
      method: "DELETE",
    });
  }

  searchMemories(params: SearchMemoriesPayload) {
    const qs = new URLSearchParams({
      query: params.query,
      agentId: params.filters.agentId,
    });
    if (params.filters.threadId) {
      qs.set("threadId", params.filters.threadId);
    }
    if (params.filters.kind) {
      qs.set("kind", params.filters.kind);
    }
    if (params.filters.tags?.length) {
      qs.set("tags", params.filters.tags.join(","));
    }
    if (params.mode) {
      qs.set("mode", params.mode);
    }
    return this.request(`/memories/search?${qs.toString()}`, {
      method: "GET",
    });
  }

  registerSchema(payload: CreateSchemaPayload): Promise<any>;
  registerSchema(
    name: string,
    schema: z.ZodTypeAny,
    options?: { description?: string; cardinality?: "single" | "multiple" }
  ): Promise<any>;
  registerSchema(
    payloadOrName: CreateSchemaPayload | string,
    schema?: z.ZodTypeAny,
    options?: { description?: string; cardinality?: "single" | "multiple" }
  ) {
    let payload: CreateSchemaPayload;

    if (typeof payloadOrName === "string") {
      if (!schema) {
        throw new Error(
          "Schema is required when passing name as first argument"
        );
      }
      payload = {
        name: payloadOrName,
        schema: schema,
        description: options?.description ?? `Schema for ${payloadOrName}`,
        cardinality: options?.cardinality ?? "single",
      };
    } else {
      payload = payloadOrName;
    }

    let schemaStr: string;
    if (typeof payload.schema === "string") {
      schemaStr = payload.schema;
    } else {
      schemaStr = JSON.stringify(
        z.toJSONSchema(payload.schema)
      );
    }

    return this.request("/schemas", {
      method: "POST",
      body: {
        ...payload,
        schema: schemaStr,
      },
    });
  }

  listSchemas() {
    return this.request(`/schemas`, {
      method: "GET",
    });
  }

  deleteSchema(filters: { name: string }) {
    return this.request(`/schemas/${encodeURIComponent(filters.name)}`, {
      method: "DELETE",
    });
  }

  // ----- private helpers -----

  private async request<T = any>(
    path: string,
    opts: { method: string; body?: unknown }
  ): Promise<T> {
    const method = opts.method.toUpperCase();
    const bodyJson =
      opts.body && method !== "GET" ? JSON.stringify(opts.body) : undefined;

    const url = `${this.baseUrl}${path}`;
    const authHeaders = await this.buildAuthHeaders({
      method,
      path,
      body: bodyJson ?? "",
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...authHeaders,
    };

    const res = await this.fetchFn(url, {
      method,
      headers,
      body: method === "GET" ? undefined : bodyJson,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error (${res.status} ${res.statusText}): ${text}`);
    }
    return (await res.json()) as T;
  }

  // ----- signing helpers -----
  private async buildAuthHeaders(payload: {
    method: string;
    path: string;
    body: string;
  }) {
    // Get the address from the signer
    const bodyHash = createHash("sha256").update(payload.body).digest("hex");
    const timestamp = Date.now().toString();
    const canonical = [
      payload.method.toUpperCase(),
      payload.path,
      bodyHash,
      timestamp,
    ].join("|");

    // Check if signer is an EVM or Solana
    const { address } = this.signer as { address: string };
    const signature = address.startsWith("0x")
      ? await this.signWithEvm(canonical)
      : await this.signWithSolana(canonical);

    return {
      "x-wallet-address": address,
      "x-wallet-timestamp": timestamp,
      "x-wallet-signature": signature,
    };
  }

  private async signWithEvm(message: string) {
    const s = this.signer as unknown as EvmSigner;
    return s.signMessage(message);
  }

  private async signWithSolana(message: string) {
    const s = this.signer as unknown as MessagePartialSigner;
    const address = s.address;

    const signableMessage = createSignableMessage(message);
    const [signedMessage] = await s.signMessages([signableMessage]);

    return Buffer.from(signedMessage[address]).toString("base64");
  }
}

// Convenience helpers to instantiate for common environments

/**
 * Create a new MemoryClient instance from a private key.
 * Uses the same wallet to sign both auth and x402 requests.
 *
 * @example
 * ```typescript
 * const client = await fromPrivateKey(
 *   "solana-devnet",
 *   "0x1234567890abcdef",
 *   {
 *     maxValue: 5_000n, // Optional, defaults to 0.1 USDC
 *     rpcUrl: "https://api.devnet.solana.com", // Optional, defaults to the public RPC URL for the chain
 *   }
 * );
 * ```
 * @param chain - The chain to use for the x402 signer (@see https://github.com/coinbase/x402/blob/main/typescript/packages/x402/src/types/shared/network.ts)
 * @param baseUrl - The base URL of the API. Default: https://api.zkstash.ai
 * @param signerPrivateKey - The private key of the signer. Also used to sign x402 requests.
 * @param paymentConfig - The payment configuration
 * @returns A new MemoryClient instance
 */
export async function fromPrivateKey(
  chain: string,
  baseUrl: string = 'https://api.zkstash.ai',
  signerPrivateKey: string,
  paymentConfig?: Omit<PaymentConfig, "signer">
) {
  const signer = await createSigner(chain, signerPrivateKey);
  return new MemoryClient({
    baseUrl,
    signer,
    payment: {
      signer,
      ...paymentConfig,
    },
  });
}
