import type {
  Signer as X402Signer,
  PaymentRequirementsSelector,
  X402Config,
  MultiNetworkSigner as X402MultiNetworkSigner,
} from "x402-fetch";

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
