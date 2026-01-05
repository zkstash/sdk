import { z } from "zod";
import { createHash } from "crypto";

import { wrapFetchWithPayment, type Signer as X402Signer } from "x402-fetch";

import type {
  PaymentConfig,
  SignedGrant,
  CreateGrantOptions,
  CreateAttestationOptions,
  Attestation,
  DirectMemory,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  SearchMemoriesRequest,
  SearchMemoriesFilters,
  ExtendedSearchRequest,
  CreateSchemaRequest,
  UpdateSchemaRequest,
  MemoriesResponse,
  SchemaResponse,
  SchemasResponse,
} from "./types.js";

// Type aliases for easier usage in client

export type ClientSearchFilters = Omit<SearchMemoriesFilters, "userId">;

export type ClientSearchRequest = Omit<ExtendedSearchRequest, "filters"> & {
  filters: ClientSearchFilters;
};

export type ClientBatchSearchQuery = Omit<SearchMemoriesRequest, "filters"> & {
  filters: ClientSearchFilters;
};

export type CreateSchemaInput = Omit<CreateSchemaRequest, "schema"> & {
  schema: string | z.ZodTypeAny;
};

export type UpdateSchemaInput = Omit<UpdateSchemaRequest, "schema"> & {
  schema?: string | z.ZodTypeAny;
};

import {
  signWithEvm,
  signWithSolana,
  signerFromPrivateKey,
  signGrant,
  grantToShareCode,
  grantFromShareCode,
  parseDuration,
  stableStringify,
  verifyEd25519,
} from "./utils.js";

// ------------------------------

type SearchMemoriesOptions = {
  /** Additional grants to include for this request */
  grants?: SignedGrant[];
  /**
   * Search scope - controls which namespaces to search.
   * - "own": Search only your own namespace (ignores grants)
   * - "shared": Search only granted namespaces (requires grants)
   * - "all": Search both own and granted namespaces (default)
   */
  scope?: "own" | "shared" | "all";
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

  /** Grants stored in this instance for automatic inclusion in searches */
  private instanceGrants: SignedGrant[] = [];

  /** Cached attestation public key for local verification */
  private cachedPublicKey: string | null = null;

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

  /**
   * Create memories via LLM extraction from a conversation.
   * Use this when you want the AI to analyze the conversation and extract relevant facts.
   */
  createMemory(payload: CreateMemoryRequest): Promise<MemoriesResponse> {
    if (!payload.conversation && !payload.memories) {
      throw new Error("Either 'conversation' or 'memories' must be provided");
    }
    return this.request("/memories", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Store structured memories directly without LLM extraction.
   * Use this when you already have structured data (e.g., from agent tool calls).
   *
   * @example
   * ```typescript
   * // Basic usage
   * await client.storeMemories("agent-1", [
   *   { kind: "UserProfile", data: { name: "Alice", age: 30 } },
   *   { kind: "Preference", data: { category: "food", value: "vegetarian" } }
   * ]);
   *
   * // With TTL (expires in 24 hours)
   * await client.storeMemories("agent-1", [
   *   { kind: "SessionContext", data: { task: "booking" }, ttl: "24h" }
   * ]);
   *
   * // With default TTL for all memories
   * await client.storeMemories("agent-1", memories, { ttl: "7d" });
   * ```
   */
  storeMemories(
    agentId: string,
    memories: DirectMemory[],
    options?: { threadId?: string; ttl?: string; expiresAt?: number }
  ): Promise<MemoriesResponse> {
    return this.request("/memories", {
      method: "POST",
      body: {
        agentId,
        threadId: options?.threadId,
        ttl: options?.ttl,
        expiresAt: options?.expiresAt,
        memories,
      } as CreateMemoryRequest,
    });
  }

  updateMemory(id: string, params: UpdateMemoryRequest) {
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

  /**
   * Verify a memory's integrity locally by recomputing its content hash.
   * No API call required - verification is done entirely client-side.
   *
   * @param memory - The memory object (from search or get)
   * @returns Integrity verification result
   *
   * @example
   * ```typescript
   * const { memory } = await client.getMemory("mem_abc123");
   * const result = client.verifyMemoryIntegrity(memory);
   * if (result.intact) {
   *   console.log("Memory is intact");
   * } else {
   *   console.log("Memory may have been tampered with");
   *   console.log("Stored:", result.storedHash);
   *   console.log("Computed:", result.computedHash);
   * }
   * ```
   */
  verifyMemoryIntegrity(memory: {
    kind: string;
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): {
    intact: boolean;
    storedHash: string | null;
    computedHash: string;
    verifiedAt: number;
  } {
    const metadata = memory.metadata || {};
    const storedHash = (metadata.contentHash as string) || null;
    const agentId = metadata.agentId as string;

    // Extract data - either from memory.data or from metadata (excluding system fields)
    const systemFields = [
      "agentId",
      "threadId",
      "kind",
      "tags",
      "confidence",
      "expiresAt",
      "updatedAt",
      "contentHash",
    ];
    const data =
      memory.data ||
      Object.fromEntries(
        Object.entries(metadata).filter(([k]) => !systemFields.includes(k))
      );

    // Compute hash: sha256(stableStringify({ kind, data, agentId }))
    const content = stableStringify({ kind: memory.kind, data, agentId });
    const computedHash =
      "0x" + createHash("sha256").update(content).digest("hex");

    return {
      intact: storedHash === computedHash,
      storedHash,
      computedHash,
      verifiedAt: Date.now(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Attestations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a signed attestation about your memories.
   * Attestations allow you to prove claims to other agents without
   * revealing the actual memory content.
   *
   * @param options - Attestation options
   * @returns Signed attestation with zkStash public key
   *
   * @example
   * ```typescript
   * // Prove you have memories matching a query
   * const attestation = await client.createAttestation({
   *   claim: "has_memories_matching",
   *   query: "user preferences",
   *   filters: { agentId: "my-agent" },
   * });
   *
   * // Prove you have at least 10 memories
   * const attestation = await client.createAttestation({
   *   claim: "memory_count_gte",
   *   threshold: 10,
   * });
   *
   * // Share attestation with another agent
   * anotherAgent.verifyAttestation(attestation);
   * ```
   */
  createAttestation(options: CreateAttestationOptions): Promise<{
    success: boolean;
    attestation: Attestation;
    signature: string;
    publicKey: string;
  }> {
    return this.request("/attestations", {
      method: "POST",
      body: options,
    });
  }

  /**
   * Verify an attestation signature locally using Ed25519.
   * The public key is fetched once from /.well-known/zkstash-keys.json and cached.
   *
   * @param attestation - The attestation object
   * @param signature - The signature to verify
   * @returns Verification result with valid flag and reason
   *
   * @example
   * ```typescript
   * const { valid, reason } = await client.verifyAttestation(
   *   receivedAttestation.attestation,
   *   receivedAttestation.signature
   * );
   * if (valid) {
   *   console.log("Attestation verified");
   * } else {
   *   console.log("Invalid:", reason); // "invalid_signature" or "attestation_expired"
   * }
   * ```
   */
  async verifyAttestation(
    attestation: Attestation,
    signature: string
  ): Promise<{ valid: boolean; reason: string | null }> {
    // Check expiry first
    const now = Math.floor(Date.now() / 1000);
    if (attestation.expiresAt < now) {
      return { valid: false, reason: "attestation_expired" };
    }

    // Fetch and cache public key if needed
    if (!this.cachedPublicKey) {
      const res = await fetch(`${this.baseUrl}/.well-known/zkstash-keys.json`);
      const data = await res.json();
      this.cachedPublicKey = data.attestationPublicKey;
    }

    // Verify Ed25519 signature locally
    const message = stableStringify(attestation);
    const valid = verifyEd25519(signature, message, this.cachedPublicKey!);

    return { valid, reason: valid ? null : "invalid_signature" };
  }

  /**
   * Search for memories.
   *
   * @param params - Search parameters (query, filters, mode)
   * @param options - Optional settings for grants and search scope
   * @returns Search results with source annotations
   *
   * @example
   * ```typescript
   * // Search your own memories only
   * await client.searchMemories(
   *   { query: "preferences", filters: { agentId: "my-agent" } },
   *   { scope: "own" }
   * );
   *
   * // Search only shared memories (from grants)
   * await client.searchMemories(
   *   { query: "findings", filters: { agentId: "researcher" } },
   *   { grants: [grantFromResearcher], scope: "shared" }
   * );
   *
   * // Search both (default)
   * await client.searchMemories(
   *   { query: "everything", filters: { agentId: "any" } },
   *   { grants: [grantFromA, grantFromB] }  // scope defaults to "all"
   * );
   * ```
   */
  searchMemories(
    params: ClientSearchRequest,
    options?: SearchMemoriesOptions
  ): Promise<MemoriesResponse> {
    const queryParams: Record<string, string> = {
      query: params.query,
    };
    if (params.filters.agentId) {
      queryParams.agentId = params.filters.agentId;
    }
    const qs = new URLSearchParams(queryParams);
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

    // Set search scope
    const scope = options?.scope ?? "all";
    if (scope !== "all") {
      qs.set("scope", scope);
    }

    // Collect grants to include in header (skip if scope is "own")
    const grantsToInclude =
      scope === "own"
        ? []
        : [...this.instanceGrants, ...(options?.grants ?? [])];

    const extraHeaders: Record<string, string> = {};
    if (grantsToInclude.length > 0) {
      extraHeaders["x-grants"] = Buffer.from(
        JSON.stringify(grantsToInclude)
      ).toString("base64");
    }

    return this.request(`/memories/search?${qs.toString()}`, {
      method: "GET",
      headers: extraHeaders,
    });
  }

  registerSchema(payload: CreateSchemaInput): Promise<SchemaResponse>;
  registerSchema(
    name: string,
    schema: z.ZodTypeAny,
    options?: { description?: string; uniqueOn?: string[] }
  ): Promise<any>;
  registerSchema(
    payloadOrName: CreateSchemaInput | string,
    schema?: z.ZodTypeAny,
    options?: { description?: string; uniqueOn?: string[] }
  ) {
    let payload: CreateSchemaInput;

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
        uniqueOn: options?.uniqueOn,
      };
    } else {
      payload = payloadOrName;
    }

    let schemaStr: string;
    if (typeof payload.schema === "string") {
      schemaStr = payload.schema;
    } else {
      schemaStr = JSON.stringify(z.toJSONSchema(payload.schema));
    }

    return this.request("/schemas", {
      method: "POST",
      body: {
        ...payload,
        schema: schemaStr,
      },
    });
  }

  listSchemas(): Promise<SchemasResponse> {
    return this.request(`/schemas`, {
      method: "GET",
    });
  }

  updateSchema(name: string, params: UpdateSchemaInput) {
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Grant Methods (Memory Sharing)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a signed grant to share memories with another agent.
   * This is done locally (no API call) - the signature is the proof.
   *
   * @example
   * ```typescript
   * const { grant, shareCode } = await client.createGrant({
   *   grantee: "0xBBB...",
   *   agentId: "researcher",  // optional: scope to specific agent
   *   expiresIn: "7d",        // or expiresAt: timestamp
   * });
   *
   * // Share the grant code with the other agent
   * console.log(shareCode);  // "zkg1_..."
   * ```
   */
  async createGrant(options: CreateGrantOptions): Promise<{
    grant: SignedGrant;
    shareCode: string;
  }> {
    if (!this.signer) {
      throw new Error(
        "Signer required to create grants. Use fromPrivateKey or fromSigner."
      );
    }

    // Calculate expiry
    let expiresAt: number;
    if (options.expiresAt) {
      expiresAt = options.expiresAt;
    } else if (options.expiresIn) {
      const seconds =
        typeof options.expiresIn === "number"
          ? options.expiresIn
          : parseDuration(options.expiresIn);
      expiresAt = Math.floor(Date.now() / 1000) + seconds;
    } else {
      // Default: 7 days
      expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    }

    const grant = await signGrant(this.signer, {
      g: options.grantee,
      a: options.agentId,
      e: expiresAt,
    });

    return {
      grant,
      shareCode: grantToShareCode(grant),
    };
  }

  /**
   * Add a grant to this instance for automatic inclusion in searches.
   * Grants added this way are sent with every search request.
   *
   * @param grantOrCode - A SignedGrant object or a share code string
   */
  addGrant(grantOrCode: SignedGrant | string): void {
    const grant =
      typeof grantOrCode === "string"
        ? grantFromShareCode(grantOrCode)
        : grantOrCode;

    // Avoid duplicates
    const exists = this.instanceGrants.some(
      (g) =>
        g.p.f === grant.p.f &&
        g.p.g === grant.p.g &&
        g.p.a === grant.p.a &&
        g.p.e === grant.p.e
    );

    if (!exists) {
      this.instanceGrants.push(grant);
    }
  }

  /**
   * Remove a grant from this instance.
   */
  removeGrant(grant: SignedGrant): void {
    this.instanceGrants = this.instanceGrants.filter(
      (g) =>
        !(
          g.p.f === grant.p.f &&
          g.p.g === grant.p.g &&
          g.p.a === grant.p.a &&
          g.p.e === grant.p.e
        )
    );
  }

  /**
   * Get all grants stored in this instance.
   */
  getInstanceGrants(): SignedGrant[] {
    return [...this.instanceGrants];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Batch Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Search multiple queries in parallel (batch operation).
   * More efficient than multiple individual searches.
   *
   * @example
   * ```typescript
   * const results = await client.batchSearchMemories([
   *   { query: "user preferences", filters: { agentId: "assistant" } },
   *   { query: "recent interactions", filters: { agentId: "assistant" } },
   * ]);
   * // results.results[0].memories, results.results[1].memories
   * ```
   */
  batchSearchMemories(
    queries: ClientBatchSearchQuery[],
    options?: SearchMemoriesOptions
  ): Promise<{
    success: boolean;
    results: Array<{ memories: MemoriesResponse["memories"] }>;
  }> {
    const scope = options?.scope ?? "all";

    // Collect grants to include in header
    const grantsToInclude =
      scope === "own"
        ? []
        : [...this.instanceGrants, ...(options?.grants ?? [])];

    const extraHeaders: Record<string, string> = {};
    if (grantsToInclude.length > 0) {
      extraHeaders["x-grants"] = Buffer.from(
        JSON.stringify(grantsToInclude)
      ).toString("base64");
    }

    return this.request("/memories/batch/search", {
      method: "POST",
      body: { queries, scope },
      headers: extraHeaders,
    });
  }

  /**
   * Delete multiple memories by ID (batch operation).
   *
   * @example
   * ```typescript
   * const result = await client.batchDeleteMemories([
   *   "mem_abc123",
   *   "mem_def456",
   * ]);
   * // result.deleted = 2
   * ```
   */
  batchDeleteMemories(
    input:
      | string[]
      | {
        agentId?: string;
        threadId?: string;
        kind?: string;
        tags?: string[];
      }
  ) {
    const body = Array.isArray(input) ? { ids: input } : { filters: input };
    return this.request<{ success: boolean; deleted: number }>(
      "/memories/batch/delete",
      {
        method: "POST",
        body,
      }
    );
  }

  /**
   * Update multiple memories with the same changes (batch operation).
   *
   * @example
   * ```typescript
   * // Add tags to multiple memories
   * await client.batchUpdateMemories(
   *   ["mem_abc123", "mem_def456"],
   *   { tags: ["archived", "q4-2024"] }
   * );
   *
   * // Set expiry on multiple memories
   * await client.batchUpdateMemories(
   *   ["mem_abc123", "mem_def456"],
   *   { expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 } // 7 days
   * );
   * ```
   */
  batchUpdateMemories(ids: string[], update: UpdateMemoryRequest) {
    return this.request<{ success: boolean; updated: number }>(
      "/memories/batch/update",
      {
        method: "POST",
        body: { ids, update },
      }
    );
  }

  // ----- private helpers -----

  private async request<T = any>(
    path: string,
    opts: { method: string; body?: unknown; headers?: Record<string, string> }
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
      ...(opts.headers ?? {}),
    };

    try {
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
    } catch (error) {
      console.error("request error:", (error as Error).message);
      throw error;
    }
  }

  // ----- signing helpers -----
  private async buildAuthHeaders(payload: {
    method: string;
    path: string;
    body: string;
  }): Promise<Record<string, string>> {
    if (this.apiKey) {
      return {
        Authorization: `Bearer ${this.apiKey}`,
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
