import { MCPBedrockIntegration } from "./integration/MCPBedrockIntegration";
import readline from "readline/promises";

async function main() {
  const integration = new MCPBedrockIntegration("us-east-1");

  try {
    await integration.initializeMCP(
      "/opt/homebrew/bin/bun",
      [
        "run",
        "/Users/martinmacecek/Documents/projects/weather-mcp-server/build/main.js",
      ],
      {
        APP_NAME: "weather-mcp-server",
        APP_EMAIL: "katjes733@gmx.net",
      },
    );

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

main();
