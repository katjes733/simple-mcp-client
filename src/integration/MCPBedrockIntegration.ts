import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { LimitedSizeArray } from "~/util/LimitedSizeArray";
import { transformMCPToolsToBedrock } from "~/util/transformMCPToolToBedrock";
import type { Message, ServerConfig } from "~/types/SimpleMcpClientTypes";
import { MCPClient } from "~/util/MCPClient";
import type { Tool, ToolUseBlock } from "@aws-sdk/client-bedrock-runtime";

const DEFAULT_MODEL_ID =
  "arn:aws:bedrock:us-east-1:275279264324:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0";
const DEFAULT_REGION = "us-east-1";

export class MCPBedrockIntegration {
  private bedrockClient: BedrockRuntimeClient;
  private defaultModelId: string;
  private messages = new LimitedSizeArray<Message>(1024 * 1024);

  private mcpClients: MCPClient[] = [];
  private tools: Tool[] = [];
  private toolsMap: { [name: string]: MCPClient } = {};
  private servers: { [name: string]: ServerConfig } = {};

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
    try {
      const jsonText = await Bun.file("./server-config.json").text();
      const configs = JSON.parse(jsonText);
      this.servers = configs as { [name: string]: ServerConfig };
    } catch (e) {
      typewriter.error("Failed to load server-config.json:", e);
      throw new Error("server-config.json not found or invalid");
    }
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
        typewriter.log(
          `Connected to server ${serverName} with tools: ${tools.map(({ name }) => name)}`,
        );
      }
    } catch (e) {
      typewriter.error("Failed to connect to MCP server: ", e);
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
      typewriter.error(`Error executing MCP tool ${toolName}:`, error);
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
        typewriter.type(message.content[0].text + "\n");
      } else {
        typewriter.type("Thinking...\n");
      }

      // Check if model wants to use tools
      const toolUses = message.content?.filter((c) => c.toolUse) || [];
      toolUses.forEach((toolUse) =>
        typewriter.log(
          `Latency for tool '${toolUse.toolUse?.name || "N/A"}' in ms:`,
          response.metrics?.latencyMs || "N/A",
        ),
      );

      if (toolUses.length === 0) {
        typewriter.log(
          "Latency for final response in ms:",
          response.metrics?.latencyMs || "N/A",
        );
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
            const result = await this.executeMCPTool(
              toolUse.toolUse.name,
              toolUse.toolUse.input,
            );
            try {
              typewriter.log("Result:", JSON.parse(result.content[0].text));
            } catch {
              typewriter.log("Result:", result.content[0].text);
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

    typewriter.log("Memory size in bytes:", this.messages.getTotalSize());

    return this.messages.all();
  }

  async handleToolConversationStream(
    userMessage: string,
    modelId: string = this.defaultModelId,
  ) {
    this.messages.push({
      role: "user" as const,
      content: [{ text: userMessage }],
    });

    while (true) {
      const command = new ConverseStreamCommand({
        modelId,
        messages: this.messages.all(),
        toolConfig: { tools: this.tools },
      });

      const response = await this.bedrockClient.send(command);
      if (!response.stream) break;
      let toolUse: ToolUseBlock = { toolUseId: "", name: "", input: "" };
      let text = "";
      for await (const chunk of response.stream) {
        if (chunk.contentBlockStart) {
          if (chunk.contentBlockStart?.start?.toolUse) {
            toolUse = {
              ...toolUse,
              ...chunk.contentBlockStart?.start?.toolUse,
            };
          }
        }
        if (chunk.contentBlockDelta) {
          if (chunk.contentBlockDelta.delta?.text) {
            typewriter.type(chunk.contentBlockDelta.delta.text);
            text += chunk.contentBlockDelta.delta.text;
          }
          if (chunk.contentBlockDelta.delta?.toolUse) {
            toolUse.input =
              (toolUse.input || "") +
              (chunk.contentBlockDelta.delta?.toolUse?.input || "");
          }
        }
        if (chunk.contentBlockStop) {
          if (chunk.contentBlockStop.contentBlockIndex === 0) {
            typewriter.type("\n");
          }
        }
        if (chunk.metadata) {
          const latency = chunk.metadata.metrics?.latencyMs || "N/A";
          if (toolUse.name) {
            typewriter.log(
              `Latency for tool '${toolUse.name}' in ms:`,
              latency,
            );
          } else {
            typewriter.log(`Latency for final response in ms:`, latency);
          }
        }
      }

      if (!toolUse || !toolUse.toolUseId || !toolUse.name || !toolUse.input) {
        break;
      }

      let parsedInput: any;
      if (typeof toolUse.input === "string") {
        parsedInput = toolUse.input ? JSON.parse(toolUse.input) : {};
      } else {
        parsedInput = toolUse.input ?? {};
      }

      this.messages.push({
        role: "assistant" as const,
        content: [
          { text: String(text) },
          {
            toolUse: {
              toolUseId: toolUse.toolUseId,
              name: toolUse.name,
              input: parsedInput,
            },
          },
        ],
      });

      const toolResults = [];
      try {
        if (!toolUse.name) {
          throw new Error("Tool name is undefined.");
        }
        let parsedInput: any;
        if (typeof toolUse.input === "string") {
          parsedInput = toolUse.input ? JSON.parse(toolUse.input) : {};
        } else {
          parsedInput = toolUse.input ?? {};
        }
        const result = await this.executeMCPTool(toolUse.name, parsedInput);
        try {
          typewriter.log("Result:", JSON.parse(result.content[0].text));
        } catch {
          typewriter.log("Result:", result.content[0].text);
        }
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            content: [{ text: JSON.stringify(result) }],
          },
        });
      } catch (error) {
        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            content: [
              {
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            status: "error" as const,
          },
        });
      }

      // Add tool results to conversation
      this.messages.push({
        role: "user" as const,
        content: toolResults,
      });
    }

    typewriter.log("Memory size in bytes:", this.messages.getTotalSize());

    return this.messages.all();
  }
}
