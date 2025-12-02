import * as MCP from "../src/mcp.js";
import { createSigner } from "x402-fetch";

const TEST_PRIVATE_KEY =
    "2XWcxyPwThSovVeZWmS5wkh7qYKUvXtftmr89X78UpbPuAut873o9FPgfhQwtQEuWSDNaqGo8Nbe2MHafC9V7vsh";

async function debugAuth() {
    // Test the signer directly
    const signer = await createSigner("solana-devnet", TEST_PRIVATE_KEY);
    console.log("Signer address:", (signer as any).address);

    // Test if it's being detected as Solana correctly
    const address = (signer as any).address;
    console.log("Is EVM (starts with 0x)?", address.startsWith("0x"));
    console.log("Is Solana?", !address.startsWith("0x"));
}

debugAuth().catch(console.error);
