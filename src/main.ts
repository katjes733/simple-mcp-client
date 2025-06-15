import { MCPBedrockIntegration } from "./integration/MCPBedrockIntegration";
import readline from "readline/promises";
import { MCPOpenAiIntegration } from "./integration/MCPOpenAiIntegration";

async function main() {
  let integration: MCPBedrockIntegration | MCPOpenAiIntegration;
  if (process.env.OPENAI_API_KEY) {
    typewriter.log("Using OpenAI");
    integration = new MCPOpenAiIntegration();
  } else {
    typewriter.log("Using Bedrock");
    integration = new MCPBedrockIntegration();
  }
  await integration.initialize();

  try {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      typewriter.log("\nMCP Client Started!");
      typewriter.log("Type your message.");

      while (true) {
        await typewriter.done();
        const message = await rl.question("\nQuery: ");
        const startTime = performance.now();
        typewriter.log("\n");
        if (process.env.STREAMING === "true") {
          await integration.handleToolConversationStream(message);
        } else {
          await integration.handleToolConversation(message);
        }
        await typewriter.done();
        const elapsedMs = performance.now() - startTime;
        typewriter.log("Total ⏱️  in ms:", Number(elapsedMs.toFixed(0)));
      }
    } finally {
      rl.close();
    }
  } catch (error) {
    typewriter.error("Error:", error);
  } finally {
    await integration.disconnect();
  }
}

export async function runClient() {
  try {
    await main();
  } catch (error) {
    typewriter.error("Fatal error while running client:", error);
    process.exit(1);
  }
}

export function startClient(isMain = import.meta.main) {
  if (isMain) {
    runClient();
  }
}

startClient();
