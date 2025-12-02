import { fromPrivateKey } from "../src";

// const TEST_PRIVATE_KEY = process.env.PRIVATE_KEY!;

const client = await fromPrivateKey(
  "solana-devnet",
  "http://localhost:3000",
  // TEST_PRIVATE_KEY
  "2XWcxyPwThSovVeZWmS5wkh7qYKUvXtftmr89X78UpbPuAut873o9FPgfhQwtQEuWSDNaqGo8Nbe2MHafC9V7vsh",
  {
    paymentRequirementsSelector: (paymentRequirements) => {
      const r = paymentRequirements.find(
        (pr) => pr.network === "solana-devnet"
      );
      return r || paymentRequirements[0];
    },
  }
);

let memoryId = "";

async function createMemory() {
  const memoryPayload = {
    agentId: "agent_demo",
    conversation: [
      { role: "user", content: "Hi, im chris. I'm training for the San Francisco marathon on April 13th and need help staying organized." },
      { role: "assistant", content: "Great! I can help with that!" },
      { role: "user", content: "Some info to give you context. Im 44, male, 180cm, 80kg. My protein goal is 2gr per day, im going to the gym 3 times per week." },
      { role: "assistant", content: "Noted! What can I do for you? " },
      { role: "user", content: "Oh, i forgot. Im going to spend xmass in Shangai this year. Remind me to visit DisneyLand on dec 25!" },
      { role: "assistant", content: "Thats soo cool!. Want me to help with anything?" },
      { role: "user", content: "Im going to the gym 4 times per week now." },
      { role: "assistant", content: "Noted!" },
    ],
  };

  memoryId = await client.createMemory(memoryPayload);
  console.log("createMemory response:", memoryId);
}

async function searchMemory() {
  const searchRes = await client.searchMemories({
    query: `whats my name`,
    filters: {
      agentId: "agent_demo",
    },
  });
  console.log("searchMemories response:", searchRes);
}

async function deleteMemory() {
  const deleteMemoryRes = await client.deleteMemory({ id: memoryId });
  console.log("deleteMemory response:", deleteMemoryRes);
}

async function registerSchema() {
  const registerSchemaRes = await client.registerSchema({
    name: "test_schema",
    description: "Test schema",
    cardinality: "single",
    schema: JSON.stringify({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    }),
  });
  console.log("registerSchema response:", registerSchemaRes);
}

async function listSchemas() {
  const listSchemasRes = await client.listSchemas();
  console.log("listSchemas response:", listSchemasRes);
}

async function deleteSchema() {
  const deleteSchemaRes = await client.deleteSchema({ name: "test_schema" });
  console.log("deleteSchema response:", deleteSchemaRes);
}

async function run() {
  // await registerSchema();
  // await listSchemas();
  // await deleteSchema();
  await createMemory();
  await searchMemory();
  // await deleteMemory();

  console.log("E2E flow completed successfully");
}

run().catch((err) => {
  console.error("E2E flow failed:", err);
  process.exitCode = 1;
});
