import { MCPBedrockIntegration } from "./integration/MCPBedrockIntegration";
import readline from "readline/promises";

async function main() {
  const integration = new MCPBedrockIntegration();
  await integration.initialize();

  try {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your message.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        console.log("\n");
        await integration.handleToolConversation(message);
      }
    } finally {
      rl.close();
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await integration.disconnect();
  }
}

export async function runClient() {
  try {
    await main();
  } catch (error) {
    console.error("Fatal error while running server:", error);
    process.exit(1);
  }
}

export function startClient(isMain = import.meta.main) {
  if (isMain) {
    runClient();
  }
}

startClient();
