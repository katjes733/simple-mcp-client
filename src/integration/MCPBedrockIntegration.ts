import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { LimitedSizeArray } from "~/util/LimitedSizeArray";
import { transformMCPToolsToBedrock } from "~/util/transformMCPToolToBedrock";
import configs from "~/../server-config.json" with { type: "json" };
import type { Message, ServerConfig } from "~/types/SimpleMcpClientTypes";
import { MCPClient } from "~/util/MCPClient";
import type { Tool } from "@aws-sdk/client-bedrock-runtime";

const DEFAULT_MODEL_ID =
  "arn:aws:bedrock:us-east-1:275279264324:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0";
const DEFAULT_REGION = "us-east-1";

export class MCPBedrockIntegration {
  private bedrockClient: BedrockRuntimeClient;
  private defaultModelId: string;
  // private mcpClient: Client | undefined = undefined;
  private messages = new LimitedSizeArray<Message>(1024 * 1024);

  private mcpClients: MCPClient[] = [];
  private tools: Tool[] = [];
  private toolsMap: { [name: string]: MCPClient } = {};
  private servers: { [name: string]: ServerConfig } = configs;

  constructor(
    {
      region = DEFAULT_REGION,
      defaultModelId = DEFAULT_MODEL_ID,
    }: {
      region: string;
      defaultModelId: string;
    } = { region: DEFAULT_REGION, defaultModelId: DEFAULT_MODEL_ID },
  ) {
    this.bedrockClient = new BedrockRuntimeClient({ region });
    this.defaultModelId = defaultModelId;
  }

  async initialize() {
    await this.connectToServers();
  }

  async connectToServers() {
    try {
      for (const serverName in this.servers) {
        const mcp = new MCPClient(serverName);
        const config = this.servers[serverName];
        await mcp.connectToServer(config);
        this.mcpClients.push(mcp);

        const tools = await mcp.getTools();
        const map: { [name: string]: MCPClient } = {};
        tools.forEach((t) => (map[t.name] = mcp));
        this.tools = [...this.tools, ...transformMCPToolsToBedrock(tools)];
        this.toolsMap = {
          ...this.toolsMap,
          ...map,
        };
        console.log(
          `Connected to server ${serverName} with tools: ${tools.map(({ name }) => name)}`,
        );
      }
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async disconnect() {
    for (const mcp of this.mcpClients) {
      await mcp.disconnect();
    }
  }

  private async executeMCPTool(toolName: string, input: any) {
    try {
      const mcpClient = this.toolsMap[toolName];
      const result = await mcpClient.callTool(toolName, input);
      return result;
    } catch (error) {
      console.error(`Error executing MCP tool ${toolName}:`, error);
      throw error;
    }
  }

  async handleToolConversation(
    userMessage: string,
    modelId: string = this.defaultModelId,
  ) {
    this.messages.push({
      role: "user" as const,
      content: [{ text: userMessage }],
    });

    while (true) {
      const command = new ConverseCommand({
        modelId,
        messages: this.messages.all(),
        toolConfig: { tools: this.tools },
      });

      const response = await this.bedrockClient.send(command);
      const message = response.output?.message;

      if (!message) break;

      this.messages.push({
        role: "assistant" as const,
        content: message.content || [],
      });

      if (message.content && message.content.length > 0) {
        console.log(message.content[0].text);
      } else {
        console.log("Thinking...");
      }

      // Check if model wants to use tools
      const toolUses = message.content?.filter((c) => c.toolUse) || [];

      if (toolUses.length === 0) {
        // No more tool calls, conversation is complete
        break;
      }

      // Execute each tool call
      const toolResults = [];
      for (const toolUse of toolUses) {
        if (toolUse.toolUse) {
          try {
            if (!toolUse.toolUse.name) {
              throw new Error("Tool name is undefined.");
            }
            console.log("input:", toolUse.toolUse.input);
            console.log("name:", toolUse.toolUse.name);
            const result = await this.executeMCPTool(
              toolUse.toolUse.name,
              toolUse.toolUse.input,
            );
            console.log(result);
            try {
              console.log("result:", JSON.parse(result.content[0].text));
            } catch {
              console.log("result:", result.content[0].text);
            }

            toolResults.push({
              toolResult: {
                toolUseId: toolUse.toolUse.toolUseId,
                content: [{ text: JSON.stringify(result) }],
              },
            });
          } catch (error) {
            toolResults.push({
              toolResult: {
                toolUseId: toolUse.toolUse.toolUseId,
                content: [
                  {
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                  },
                ],
                status: "error" as const,
              },
            });
          }
        }
      }

      // Add tool results to conversation
      this.messages.push({
        role: "user" as const,
        content: toolResults,
      });
    }

    console.log("Memory size:", this.messages.getTotalSize());

    return this.messages.all();
  }
}
