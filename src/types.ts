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
