import { z } from "zod";
import { createHash } from "crypto";

import {
  wrapFetchWithPayment,
  type Signer as X402Signer
} from "x402-fetch";

import type { PaymentConfig } from "./types.js";

import {
  signWithEvm,
  signWithSolana,
  signerFromPrivateKey,
} from "./utils.js";

// ------------------------------

type CreateMemoryPayload = {
  agentId: string;
  threadId?: string;
  schemas?: string[];
  conversation: { role: string; content: string }[];
};

type PatchMemoryPayload = {
  tags?: string[];
  extendLease?: boolean;
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

type PatchSchemaPayload = {
  description?: string;
  cardinality?: "single" | "multiple";
  schema?: string | z.ZodTypeAny; // JSON string or Zod schema
};

// ---

// Re-export types for convenience
export type { PaymentConfig } from "./types.js";

export type ZkStashOptions = {
  baseUrl?: string;
  signer?: X402Signer;
  apiKey?: string;
  payment?: PaymentConfig;
};

type FetchLike = typeof globalThis.fetch;

export class ZkStash {
  private readonly baseUrl?: string;
  private readonly signer?: X402Signer;
  private readonly apiKey?: string;
  private readonly fetchFn: FetchLike;

  constructor(opts: ZkStashOptions) {
    this.baseUrl = opts.baseUrl?.replace(/\/$/, "") || "https://api.zkstash.ai";
    this.signer = opts.signer;
    this.apiKey = opts.apiKey;

    if (!this.signer && !this.apiKey) {
      throw new Error("Either signer or apiKey must be provided");
    }

    const fetchImpl = opts.payment?.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error(
        "No fetch implementation available. Provide global fetch or payment.fetch."
      );
    }

    let wrappedFetch: FetchLike;

    if (this.signer && opts.payment) {
      wrappedFetch = wrapFetchWithPayment(
        fetchImpl,
        opts.payment.signer,
        opts.payment.maxValue,
        opts.payment.paymentRequirementsSelector,
        opts.payment.x402Config
      ) as FetchLike;
    } else {
      wrappedFetch = fetchImpl as FetchLike;
    }

    this.fetchFn = wrappedFetch;
  }

  // ----- public high-level APIs -----

  createMemory(payload: CreateMemoryPayload) {
    return this.request("/memories", {
      method: "POST",
      body: payload,
    });
  }

  updateMemory(id: string, params: PatchMemoryPayload) {
    return this.request(`/memories/${id}`, {
      method: "PATCH",
      body: params,
    });
  }

  deleteMemory(id: string) {
    return this.request(`/memories/${id}`, {
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

  updateSchema(name: string, params: PatchSchemaPayload) {
    return this.request(`/schemas/${name}`, {
      method: "PATCH",
      body: params,
    });
  }

  deleteSchema(name: string) {
    return this.request(`/schemas/${name}`, {
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
  }): Promise<Record<string, string>> {
    if (this.apiKey) {
      return {
        "Authorization": `Bearer ${this.apiKey}`,
      };
    }

    if (!this.signer) {
      throw new Error("Signer not available for wallet auth");
    }

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
      ? await signWithEvm(this.signer, canonical)
      : await signWithSolana(this.signer, canonical);

    return {
      "x-wallet-address": address,
      "x-wallet-timestamp": timestamp,
      "x-wallet-signature": signature,
    };
  }
}

// Convenience helpers to instantiate for common environments

/**
 * Create a new ZkStash instance from a private key.
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
 * @param privateKey - The private key of the signer. Also used to sign x402 requests.
 * @param options - The payment configuration
 * @returns A new ZkStash instance
 */
export async function fromPrivateKey(
  privateKey: string,
  options: {
    apiUrl?: string;
    payment?: Omit<PaymentConfig, "signer">;
  }
) {
  const signer = await signerFromPrivateKey(privateKey);
  return new ZkStash({
    baseUrl: options?.apiUrl,
    signer,
    payment: {
      signer,
      ...options?.payment,
    },
  });
}

/**
 * Create a new ZkStash instance from an existing signer.
 * Advanced: Use this when you need separate signers for authentication and payment.
 *
 * @example
 * ```typescript
 * import { createSigner } from 'x402-fetch';
 * 
 * // Create separate signers for auth and payment
 * const authSigner = await createSigner("ethereum", "0xAUTH_KEY");
 * const paymentSigner = await createSigner("base", "0xPAYMENT_KEY");
 * 
 * const client = fromSigner(authSigner, {
 *   payment: {
 *     signer: paymentSigner,
 *     maxValue: 5_000n
 *   }
 * });
 * ```
 * @param signer - The x402 signer to use for authentication
 * @param options - Optional configuration including separate payment signer
 * @returns A new ZkStash instance
 */
export function fromSigner(
  signer: X402Signer,
  options?: {
    apiUrl?: string;
    payment?: PaymentConfig;
  }
): ZkStash {
  return new ZkStash({
    baseUrl: options?.apiUrl,
    payment: options?.payment,
    signer,
  });
}


/**
 * Create a new ZkStash instance from an API key.
 * This bypasses x402 payment logic as API key users are assumed to be billed via SaaS.
 *
 * @example
 * ```typescript
 * const client = fromApiKey("zk_...");
 * ```
 * @param apiKey - The API key
 * @param options - Optional configuration
 * @returns A new ZkStash instance
 */
export function fromApiKey(
  apiKey: string,
  options?: {
    apiUrl?: string;
  }
) {
  return new ZkStash({
    apiKey,
    baseUrl: options?.apiUrl,
  });
}