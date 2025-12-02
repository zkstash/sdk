import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Signer as X402Signer } from "x402-fetch";

vi.mock("x402-fetch", () => {
  const wrapFetchWithPayment = vi.fn((fetchImpl: typeof fetch) => fetchImpl);
  const createSigner = vi.fn(async () => ({
    address: "0xfeedface",
    account: { address: "0xfeedface" },
    signMessage: vi.fn(async () => "mock-signature"),
  }));

  return {
    wrapFetchWithPayment,
    createSigner,
  };
});

import { createSigner, wrapFetchWithPayment } from "x402-fetch";
import { MemoryClient, fromPrivateKey } from "../src";

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("MemoryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends POST requests with EVM signer headers", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));

    const payload = {
      userId: "user_demo",
      agentId: "agent_demo",
      conversation: [{ role: "user", content: "hi" }],
    };

    const evmSigner = {
      address: "0xabc123",
      account: { address: "0xabc123" },
      signMessage: vi.fn(async () => "signed-evm"),
    } as unknown as X402Signer;

    const client = new MemoryClient({
      baseUrl: "https://api.example.com",
      signer: evmSigner,
      payment: {
        signer: evmSigner,
        fetch: fetchStub,
      },
    });

    await client.createMemory(payload);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/v1/memories");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(payload));
    expect(init?.headers).toMatchObject({
      "x-wallet-signature": "signed-evm",
    });
  });

  it("encodes Solana signatures as base64", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));

    const signatureBytes = Uint8Array.from([1, 2, 3]);

    const solSigner = {
      address: "SolSignerAddress",
      signMessages: vi.fn(async () => [{ SolSignerAddress: signatureBytes }]),
    } as unknown as X402Signer;

    const client = new MemoryClient({
      baseUrl: "https://api.example.com",
      signer: solSigner,
      payment: {
        signer: solSigner,
        fetch: fetchStub,
      },
    });

    await client.deleteMemory({ id: "memory_id" });

    const [, init] = fetchStub.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "x-wallet-signature": Buffer.from(signatureBytes).toString("base64"),
    });
  });

  it("supports searching memories with query params", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));

    const evmSigner = {
      address: "0xabc123",
      account: { address: "0xabc123" },
      signMessage: vi.fn(async () => "signed-evm"),
    } as unknown as X402Signer;

    const client = new MemoryClient({
      baseUrl: "https://api.example.com",
      signer: evmSigner,
      payment: {
        signer: evmSigner,
        fetch: fetchStub,
      },
    });

    await client.searchMemories({
      query: "coffee",
      filters: {
        agentId: "agent_demo",
        kind: "note",
        tags: ["tag1"],
      },
      mode: "answer",
    });

    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toContain("/api/v1/memories/search?");
    expect(url).toContain("query=coffee");
    expect(url).toContain("mode=answer");
    expect(init?.method).toBe("GET");
  });
});

describe("fromPrivateKey helper", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates a client using createSigner and wraps fetch", async () => {
    const signerMock = {
      address: "0xfeedface",
      account: { address: "0xfeedface" },
      signMessage: vi.fn(async () => "mock-sign"),
    } as unknown as X402Signer;

    vi.mocked(createSigner).mockResolvedValueOnce(signerMock);

    const client = await fromPrivateKey(
      "base-sepolia",
      "https://api.example.com",
      "0x1234567890abcdef1234567890abcdef12345678"
    );

    expect(createSigner).toHaveBeenCalledWith(
      "base-sepolia",
      "0x1234567890abcdef1234567890abcdef12345678"
    );
    expect(wrapFetchWithPayment).toHaveBeenCalled();

    await client.createMemory({
      agentId: "agent_demo",
      conversation: [{ role: "user", content: "Hello" }],
    });

    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
