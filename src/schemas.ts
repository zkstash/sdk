import { z } from "zod";

// -----------------------------------------------------------------------------
// Memory Types
// -----------------------------------------------------------------------------

const Tag = z.string().min(1).max(32);

// Base response schema (composable)
export const ResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export const ConversationMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "human", "assistant", "ai", "system"]),
  content: z.string(),
});

// Direct memory input schema (for bypassing extraction)
export const DirectMemorySchema = z.object({
  kind: z.string().min(1),
  data: z.record(z.string(), z.any()),
  id: z.string().optional(), // Optional ID for updates
  ttl: z.string().optional(), // Duration: "1h", "24h", "7d"
  expiresAt: z.number().optional(), // Unix timestamp (ms)
});

export const CreateMemoryRequestSchema = z
  .object({
    agentId: z.string(),
    threadId: z.string().optional(),
    schemas: z.array(z.string()).optional(),
    conversation: z.array(ConversationMessageSchema).optional(),
    memories: z.array(DirectMemorySchema).optional(),
    ttl: z.string().optional(), // Default TTL for all memories in request
    expiresAt: z.number().optional(), // Default expiry timestamp for all memories
  })
  .refine((data) => data.conversation || data.memories, {
    message: "Either 'conversation' or 'memories' must be provided",
  });

export const CreateMemoryResponseSchema = ResponseSchema.extend({
  created: z.array(
    z.object({
      kind: z.string(),
      metadata: z.record(z.string(), z.any()),
    })
  ),
  updated: z.array(
    z.object({
      kind: z.string(),
      metadata: z.record(z.string(), z.any()),
    })
  ),
});

export const UpdateMemoryRequestSchema = z.object({
  tags: z.array(Tag).optional(),
  expiresAt: z.number().nullable().optional(), // Set expiry (null = remove expiry, make permanent)
});

export const SearchMemoriesFiltersSchema = z.object({
  agentId: z.string().optional(),
  threadId: z.string().optional(),
  kind: z.string().optional(),
  tags: z.array(Tag).optional()
});

export const SearchMemoriesRequestSchema = z.object({
  query: z.string(),
  filters: SearchMemoriesFiltersSchema,
});

export const ExtendedSearchSchema = SearchMemoriesRequestSchema.extend({
  mode: z.enum(["raw", "answer", "map"]).default("raw"),
});

// Memory object schema
export const MemorySchema = z.object({
  id: z.string(),
  kind: z.string(),
  data: z.string(),
  metadata: z.record(z.string(), z.any()),
  score: z.number().optional(),
});

// Composable response schemas
export const MemoryResponseSchema = ResponseSchema.extend({
  memory: MemorySchema.optional(),
});

export const MemoriesResponseSchema = ResponseSchema.extend({
  memories: z.array(MemorySchema).optional(),
  memoryMap: z.string().optional(),
  answer: z.string().optional(),
});

// -----------------------------------------------------------------------------
// Schema Types
// -----------------------------------------------------------------------------

export const JsonSchemaValidator = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), z.any()),
  required: z.array(z.string()).optional(),
});

export const RegisterSchemaRequest = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  fields: z.record(z.string(), z.string()),
});

export const CreateSchemaRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  uniqueOn: z
    .array(z.string())
    .optional()
    .describe(
      "Fields that identify 'same entity' for auto-supersede. " +
      "E.g., ['kind'] means only one memory of this kind per user."
    ),
  schema: z.string(),
});

export const UpdateSchemaRequestSchema = CreateSchemaRequestSchema.omit({
  name: true,
});

// Schema object
export const SchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  uniqueOn: z.array(z.string()).optional(),
  schema: z.string(),
});

// Composable response schemas
export const SchemaResponseSchema = ResponseSchema.extend({
  schema: SchemaSchema.optional(),
});

export const SchemasResponseSchema = ResponseSchema.extend({
  schemas: z.array(SchemaSchema).optional(),
});

export const SchemaUpdatedResponseSchema = ResponseSchema.extend({
  updated: z.boolean().optional(),
});
