import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { fromPrivateKey, fromApiKey, ZkStash } from "../src/rest";
import type { ConversationMessage, DirectMemory } from "../src/types";
import { grantFromShareCode } from "../src/utils";
import { z } from "zod";

/**
 * Integration tests for zkstash-sdk
 *
 * Run with: ZKSTASH_API_KEY=zk_... pnpm vitest run test/integration.test.ts
 *
 * Environment variables:
 * - ZKSTASH_API_KEY: API key for authentication (preferred for CI)
 * - ZKSTASH_PRIVATE_KEY: Wallet private key (alternative auth)
 * - ZKSTASH_API_URL: Custom API URL (default: https://api.zkstash.ai)
 */

const API_KEY = process.env.ZKSTASH_API_KEY;
const PRIVATE_KEY = process.env.ZKSTASH_PRIVATE_KEY;
const API_URL = process.env.ZKSTASH_API_URL;

// Skip all tests if no credentials are provided
const shouldRun = API_KEY || PRIVATE_KEY;

describe.skipIf(!shouldRun)("ZkStash Integration Tests", () => {
  let client: ZkStash;

  const testAgentId = `test-agent-integration`;
  const testThreadId = `test-thread-integration`;
  const testSchemaName = `test_schema_integration`;

  const createdMemoryIds: string[] = [];

  beforeAll(async () => {
    if (API_KEY) {
      client = fromApiKey(API_KEY, { apiUrl: API_URL });
    } else if (PRIVATE_KEY) {
      client = await fromPrivateKey(PRIVATE_KEY, { apiUrl: API_URL });
    }

    // Clean test
    try {
      await Promise.all([
        client.batchDeleteMemories({ filters: { agentId: testAgentId } }),
        client.deleteSchema(testSchemaName),
      ]);
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Cleanup: delete all created memories
    if (createdMemoryIds.length > 0) {
      try {
        await Promise.all([
          client.batchDeleteMemories({ filters: { agentId: testAgentId } }),
          client.deleteSchema(testSchemaName),
        ]);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Memory Lifecycle", () => {
    it(
      "should create memories from conversation",
      { timeout: 10000 },
      async () => {
        const conversation: ConversationMessage[] = [
          { role: "user", content: "My name is Alice and I live in Seattle." },
          { role: "assistant", content: "Nice to meet you, Alice!" },
        ];

        const result = await client.createMemory({
          agentId: testAgentId,
          threadId: testThreadId,
          conversation,
          //
          force: true, // Bypass idempotency check
        });

        expect(result.success).toBe(true);
        expect(result.created).toBeDefined();
        expect(result.created!.length).toBeGreaterThan(0);

        console.log(JSON.stringify(result, null, 2));

        // Track for cleanup
        result.created!.forEach((m) => createdMemoryIds.push(m.id));
      }
    );

    it("should store direct memories", async () => {
      const memories: DirectMemory[] = [
        {
          kind: "preference_memory",
          data: {
            subject: "Alice",
            preferenceType: "likes",
            preference: "likes the color blue",
          },
        },
        {
          kind: "preference_memory",
          data: {
            subject: "Alice",
            domain: "food",
            preferenceType: "likes",
            preference: "likes to eat sushi",
          },
        },
      ];

      const result = await client.storeMemories({
        agentId: testAgentId,
        threadId: testThreadId,
        memories,
      });

      console.log(JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.created).toBeDefined();
      expect(result.created!.length).toBe(2);

      result.created!.forEach((m) => createdMemoryIds.push(m.id));
    });

    it("should store memory with TTL", async () => {
      const memories: DirectMemory[] = [
        {
          kind: "preference_memory",
          data: {
            subject: "Alice",
            preferenceType: "likes",
            preference: "play with cats",
          },
          ttl: "1h",
        },
      ];

      const result = await client.storeMemories({
        agentId: testAgentId,
        memories,
      });

      expect(result.success).toBe(true);
      expect(result.created![0]).toBeDefined();

      // Verify expiry is set (approximately 1 hour from now)
      const memory = result.created![0];
      const expectedExpiry = Math.floor(Date.now() / 1000) + 3600;
      expect(memory.metadata?.expiresAt).toBeDefined();
      expect(
        Math.abs((memory.metadata!.expiresAt as number) / 1000 - expectedExpiry)
      ).toBeLessThan(60);

      createdMemoryIds.push(memory.id);
    });

    it("should search memories by query", async () => {
      // Wait a moment for indexing
      await new Promise((r) => setTimeout(r, 1000));

      const result = await client.searchMemories({
        query: "Alice Seattle",
        filters: { agentId: testAgentId },
      });

      expect(result.success).toBe(true);
      expect(result.memories).toBeDefined();
      expect(result.memories!.length).toBeGreaterThan(0);
    });

    it("should search memories with filters", async () => {
      const result = await client.searchMemories({
        query: "preferences",
        filters: {
          agentId: testAgentId,
          kind: "UserPreference",
        },
      });

      expect(result.success).toBe(true);
      expect(result.memories!.every((m) => m.kind === "UserPreference")).toBe(
        true
      );
    });

    it("should update a memory", async () => {
      const memoryId = createdMemoryIds[0];
      if (!memoryId) throw new Error("No memory to update");

      const result = await client.updateMemory(memoryId, {
        tags: ["integration-test", "updated"],
      });

      expect(result.success).toBe(true);
    });

    it("should delete a memory", async () => {
      const memoryId = createdMemoryIds.pop();
      if (!memoryId) throw new Error("No memory to delete");

      const result = await client.deleteMemory(memoryId);

      expect(result.success).toBe(true);
    });
  });

  describe("Batch Operations", () => {
    let batchMemoryIds: string[] = [];

    beforeAll(async () => {
      // Create memories for batch tests
      const memories: DirectMemory[] = Array.from({ length: 5 }, (_, i) => ({
        kind: "factual_memory",
        data: { fact: `item-${i}`, subject: "Alice", source: "user" },
      }));

      const result = await client.storeMemories({
        agentId: testAgentId,
        memories,
      });
      batchMemoryIds = result.created!.map((m) => m.id);
    });

    afterAll(async () => {
      // Cleanup is handled by the parent afterAll
      createdMemoryIds.push(...batchMemoryIds);
    });

    it("should batch search multiple queries", async () => {
      await new Promise((r) => setTimeout(r, 500));

      const result = await client.batchSearchMemories([
        { query: "item-0", filters: { agentId: testAgentId } },
        { query: "item-2", filters: { agentId: testAgentId } },
      ]);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it("should batch update memories", async () => {
      const idsToUpdate = batchMemoryIds.slice(0, 2);

      const result = await client.batchUpdateMemories({
        ids: idsToUpdate,
        update: { tags: ["batch-updated"] },
      });

      expect(result.success).toBe(true);
      expect(result.updated).toBe(2);
    });

    it("should batch delete by filter", async () => {
      const result = await client.batchDeleteMemories({
        filters: { agentId: testAgentId, kind: "factual_memory" },
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBeGreaterThan(0);

      // Clear tracking since they're deleted
      batchMemoryIds = [];
    });
  });

  describe("Schema Operations", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      tags: z.array(z.string()).optional(),
    });

    it("should register a schema", async () => {
      const result = await client.registerSchema({
        name: testSchemaName,
        description: "Test schema for integration tests",
        schema: schema,
        uniqueOn: ["name"],
      });

      expect(result.success).toBe(true);
    });

    it("should list schemas including the test schema", async () => {
      const result = await client.listSchemas();

      console.log(JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.schemas).toBeDefined();

      const found = result.schemas!.find((s) => s.name === testSchemaName);
      expect(found).toBeDefined();
      expect(found!.description).toBe("Test schema for integration tests");
    });

    it("should update a schema", async () => {
      const result = await client.updateSchema(testSchemaName, {
        description: "Updated test schema description",
      });

      expect(result.success).toBe(true);
    });

    it("should delete a schema", async () => {
      const result = await client.deleteSchema(testSchemaName);

      expect(result.success).toBe(true);
    });
  });

  describe("Attestations", () => {
    let attestationMemoryId: string;

    beforeAll(async () => {
      // Create a memory for attestation tests
      const result = await client.storeMemories({
        agentId: testAgentId,
        memories: [
          {
            kind: "factual_memory",
            data: {
              fact: "test-attestation",
              subject: "Alice",
              source: "user",
            },
          },
        ],
      });
      attestationMemoryId = result.created![0].id;
      createdMemoryIds.push(attestationMemoryId);
    });

    it("should create an attestation", async () => {
      const result = await client.createAttestation({
        claim: "has_memories_matching",
        query: "test-attestation",
        filters: { agentId: testAgentId },
      });

      expect(result.success).toBe(true);
      expect(result.attestation).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(result.publicKey).toBeDefined();
    });

    it("should verify a valid attestation", async () => {
      const { attestation, signature } = await client.createAttestation({
        claim: "memory_count_gte",
        threshold: 1,
      });

      const verification = await client.verifyAttestation(
        attestation,
        signature
      );

      expect(verification.valid).toBe(true);
      expect(verification.reason).toBeNull();
    });

    it("should detect expired attestation", async () => {
      const { attestation, signature } = await client.createAttestation({
        claim: "memory_count_gte",
        threshold: 1,
        expiresIn: "1s", // Very short expiry
      });

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 2500));

      const verification = await client.verifyAttestation(
        attestation,
        signature
      );

      expect(verification.valid).toBe(false);
      expect(verification.reason).toBe("attestation_expired");
    });
  });

  describe("Search Scopes", () => {
    it("should search only own memories with scope: own", async () => {
      const result = await client.searchMemories(
        {
          query: "test",
          filters: { agentId: testAgentId },
        },
        { scope: "own" }
      );

      expect(result.success).toBe(true);
      // All results should be from own namespace (no shared source in metadata)
      result.memories!.forEach((m) => {
        expect(m.metadata?.source).not.toBe("shared");
      });
    });
  });
});

describe.skipIf(!PRIVATE_KEY)("Grant Integration Tests", () => {
  // These tests require a private key to sign grants
  let grantor: ZkStash;
  let grantee: ZkStash;
  const grantorAgentId = `grantor-${randomUUID().slice(0, 8)}`;
  const grantorMemoryIds: string[] = [];

  // Use second hardhat account as grantee for testing
  const GRANTEE_KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  beforeAll(async () => {
    grantor = await fromPrivateKey(PRIVATE_KEY!, { apiUrl: API_URL });
    grantee = await fromPrivateKey(GRANTEE_KEY, { apiUrl: API_URL });

    // Create some memories as grantor
    const result = await grantor.storeMemories({
      agentId: grantorAgentId,
      memories: [
        {
          kind: "factual_memory",
          data: { fact: "quantum computing", subject: "Alice", source: "user" },
        },
        {
          kind: "factual_memory",
          data: { fact: "machine learning", subject: "Alice", source: "user" },
        },
      ],
    });
    grantorMemoryIds.push(...result.created!.map((m) => m.id));
  });

  afterAll(async () => {
    // Cleanup grantor memories
    if (grantorMemoryIds.length > 0) {
      try {
        await grantor.batchDeleteMemories({ ids: grantorMemoryIds });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("should create a grant and encode as share code", async () => {
    const granteeAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Hardhat #1

    const { grant, shareCode } = await grantor.createGrant({
      grantee: granteeAddress,
      agentId: grantorAgentId,
      expiresIn: "1h",
    });

    expect(grant.p.f).toBeDefined(); // Grantor address
    expect(grant.p.g).toBe(granteeAddress);
    expect(grant.s).toBeDefined(); // Signature
    expect(shareCode).toMatch(/^zkg1_/);

    // Decode and verify it matches
    const decoded = grantFromShareCode(shareCode);
    expect(decoded).toEqual(grant);
  });

  it("should allow grantee to search grantor memories with grant", async () => {
    const granteeAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    // Create grant
    const { grant } = await grantor.createGrant({
      grantee: granteeAddress,
      agentId: grantorAgentId,
      expiresIn: "1h",
    });

    // Wait for indexing
    await new Promise((r) => setTimeout(r, 1000));

    // Search using the grant
    const result = await grantee.searchMemories(
      {
        query: "quantum computing",
        filters: { agentId: grantorAgentId },
      },
      { grants: [grant], scope: "shared" }
    );

    expect(result.success).toBe(true);
    // Should find shared memories (source is in metadata)
    expect(result.memories!.some((m) => m.metadata?.source === "shared")).toBe(
      true
    );
  });

  it("should support adding grants to instance", async () => {
    const { shareCode } = await grantor.createGrant({
      grantee: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      expiresIn: "1h",
    });

    // Add grant to instance
    grantee.addGrant(shareCode);

    const grants = grantee.getInstanceGrants();
    expect(grants).toHaveLength(1);

    // Remove it
    grantee.removeGrant(grants[0]);
    expect(grantee.getInstanceGrants()).toHaveLength(0);
  });
});
