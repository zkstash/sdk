import type {
  Signer as X402Signer,
  PaymentRequirementsSelector,
  X402Config,
  MultiNetworkSigner as X402MultiNetworkSigner,
} from "x402-fetch";
import { z } from "zod";
import {
  CreateMemoryRequestSchema,
  ConversationMessageSchema,
  CreateMemoryResponseSchema,
  UpdateMemoryRequestSchema,
  SearchMemoriesFiltersSchema,
  SearchMemoriesRequestSchema,
  MemorySchema,
  MemoriesResponseSchema,
  CreateSchemaRequestSchema,
  SchemaSchema,
  SchemaResponseSchema,
  SchemasResponseSchema,
  JsonSchemaValidator,
  MemoryResponseSchema,
  ExtendedSearchSchema,
  UpdateSchemaRequestSchema,
  RegisterSchemaRequest,
  SchemaUpdatedResponseSchema,
  DirectMemorySchema,
  EntityMentionSchema,
  LLMMemorySchema,
  LLMSearchResponseSchema,
  UpdateMemoryResponseSchema,
} from "./schemas";

/**
 * Payment configuration for x402 requests.
 * Used when authenticating with wallet/private key.
 */
export type PaymentConfig = {
  signer: X402Signer | X402MultiNetworkSigner;
  maxValue?: bigint;
  paymentRequirementsSelector?: PaymentRequirementsSelector;
  x402Config?: X402Config;
  fetch?: typeof fetch;
};

/**
 * Options for creating an MCP client from a private key.
 */
export interface McpFromPrivateKeyOptions {
  /** The agent ID (required for MCP) */
  agentId: string;
  /** The subject ID for multi-tenant isolation (optional) */
  subjectId?: string;
  /** The thread ID (optional) */
  threadId?: string;
  /** The base URL for the MCP endpoint */
  mcpUrl?: string;
  /** Payment configuration (optional, uses defaults if not provided) */
  payment?: Omit<PaymentConfig, "signer">;
}

/**
 * Options for creating an MCP client from an API key.
 */
export interface McpFromApiKeyOptions {
  /** The base URL for the MCP endpoint */
  mcpUrl?: string;
  /** The agent ID (required for MCP) */
  agentId: string;
  /** The subject ID for multi-tenant isolation (optional) */
  subjectId?: string;
  /** The thread ID (optional) */
  threadId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grant Types for Memory Sharing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grant payload - the data that gets signed by the grantor.
 * This enables permissionless memory sharing between agents.
 */
export interface GrantPayload {
  /** Grantor wallet address (the signer / memory owner) */
  f: string;
  /** Grantee wallet address (who receives access) */
  g: string;
  /** Optional: Limit access to a specific agentId. Omit for all agents. */
  a?: string;
  /** Optional: Limit access to a specific subjectId. Omit for all subjects. */
  u?: string;
  /** Expiration timestamp (unix seconds) */
  e: number;
}

/**
 * Signed grant - a complete grant with signature.
 * This is the bearer token that grantees present to access memories.
 */
export interface SignedGrant {
  /** The signed payload */
  p: GrantPayload;
  /** Signature (hex for EVM, base64 for Solana) */
  s: string;
  /** Chain type - determines verification method */
  c: "evm" | "sol";
}

/**
 * Options for creating a grant.
 */
export interface CreateGrantOptions {
  /** Grantee wallet address */
  grantee: string;
  /** Optional: Limit access to a specific agentId */
  agentId?: string;
  /** Optional: Limit access to a specific subjectId */
  subjectId?: string;
  /** Expiration: duration string ("7d", "24h", "30m") or unix timestamp */
  expiresIn?: string | number;
  /** Expiration: explicit timestamp (alternative to expiresIn) */
  expiresAt?: number;
}

/**
 * Grant constants.
 */
export const GRANT_MESSAGE_PREFIX = "zkstash:grant:v1:";
export const SHARE_CODE_PREFIX = "zkg1_";

// ─────────────────────────────────────────────────────────────────────────────
// Attestation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attestation claim types supported by zkStash.
 */
export type AttestationClaim =
  | "has_memories_matching" // Agent has memories matching a query
  | "memory_count_gte" // Agent has >= N memories
  | "has_schema" // Agent has a registered schema
  | "shared_memories_from"; // Memories came from specific grantor

/**
 * Attestation - what zkStash attests to.
 */
export interface Attestation {
  claim: AttestationClaim;
  params: {
    query?: string;
    filters?: {
      agentId?: string;
      subjectId?: string;
      kind?: string;
      tags?: string[];
    };
    threshold?: number;
    schemaName?: string;
    grantor?: string;
    memoryHashes?: string[];
  };
  result: {
    satisfied: boolean;
    matchCount?: number;
    namespace: string; // Hashed userId for privacy
  };
  issuedAt: number;
  expiresAt: number;
  issuer: "zkstash.ai";
}

/**
 * Signed attestation - attestation with zkStash signature.
 */
export interface SignedAttestation {
  attestation: Attestation;
  signature: string;
}

/**
 * Options for creating an attestation.
 */
export interface CreateAttestationOptions {
  claim: AttestationClaim;
  query?: string;
  filters?: {
    agentId?: string;
    subjectId?: string;
    kind?: string;
    tags?: string[];
  };
  threshold?: number;
  schemaName?: string;
  /** Expiration duration (e.g., "24h", "7d"). Defaults to "24h". */
  expiresIn?: string;
}

/**
 * Result of attestation verification.
 */
export interface VerifyAttestationResult {
  success: boolean;
  valid: boolean;
  reason: string | null;
  attestation: Attestation | null;
  publicKey: string;
}

// -----------------------------------------------------------------------------
// Inferred Types from Zod Schemas
// -----------------------------------------------------------------------------

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type DirectMemory = z.infer<typeof DirectMemorySchema>;
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequestSchema>;
export type CreateMemoryResponse = z.infer<typeof CreateMemoryResponseSchema>;
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>;
export type UpdateMemoryResponse = z.infer<typeof UpdateMemoryResponseSchema>;

export type SearchMemoriesFilters = z.infer<typeof SearchMemoriesFiltersSchema>;
export type SearchMemoriesRequest = z.infer<typeof SearchMemoriesRequestSchema>;
export type ExtendedSearchRequest = z.infer<typeof ExtendedSearchSchema>;

export type Memory = z.infer<typeof MemorySchema>;
export type MemoryResponse = z.infer<typeof MemoryResponseSchema>;
export type MemoriesResponse = z.infer<typeof MemoriesResponseSchema>;

export type JsonSchema = z.infer<typeof JsonSchemaValidator>;
export type RegisterSchema = z.infer<typeof RegisterSchemaRequest>;
export type CreateSchemaRequest = z.infer<typeof CreateSchemaRequestSchema>;
export type UpdateSchemaRequest = z.infer<typeof UpdateSchemaRequestSchema>;
export type Schema = z.infer<typeof SchemaSchema>;
export type SchemaResponse = z.infer<typeof SchemaResponseSchema>;
export type SchemasResponse = z.infer<typeof SchemasResponseSchema>;
export type SchemaUpdatedResponse = z.infer<typeof SchemaUpdatedResponseSchema>;

// LLM Memory types (for search mode: "llm")
export type EntityMention = z.infer<typeof EntityMentionSchema>;
export type LLMMemory = z.infer<typeof LLMMemorySchema>;
export type LLMSearchResponse = z.infer<typeof LLMSearchResponseSchema>;
