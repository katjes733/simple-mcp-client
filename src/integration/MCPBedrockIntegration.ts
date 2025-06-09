import {
  BedrockRuntimeClient,
  ContentBlock,
  ConversationRole,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LimitedSizeArray } from "~/util/LimitedSizeArray";
import { transformMCPToolsToBedrock } from "~/util/transformMCPToolToBedrock";

const DEFAULT_MODEL_ID =
  "arn:aws:bedrock:us-east-1:275279264324:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0";

type Message = {
  role: ConversationRole;
  content: ContentBlock[];
};
export class MCPBedrockIntegration {
  private bedrockClient: BedrockRuntimeClient;
  private mcpClient: Client | undefined = undefined;
  private messages = new LimitedSizeArray<Message>(1024 * 1024);

  constructor(region: string = "us-east-1") {
    this.bedrockClient = new BedrockRuntimeClient({ region });
  }

  async initializeMCP(
    command: string,
    args: string[] = [],
    env?: Record<string, any>,
  ) {
    const transport = new StdioClientTransport({
      command,
      args,
      env,
    });

    this.mcpClient = new Client(
      {
        name: "bedrock-mcp-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    await this.mcpClient.connect(transport);
  }

  async getAvailableTools() {
    if (!this.mcpClient) {
      throw new Error("Not initialized.");
    }
    const toolsResult = await this.mcpClient.listTools();
    return transformMCPToolsToBedrock(toolsResult.tools);
  }

  async converseWithTools(
    message: string,
    // modelId: string = "anthropic.claude-sonnet-4-20250514-v1:0",
    modelId: string = DEFAULT_MODEL_ID,
  ) {
    const tools = await this.getAvailableTools();

    const command = new ConverseCommand({
      modelId,
      messages: [
        {
          role: "user",
          content: [{ text: message }],
        },
      ],
      toolConfig: {
        tools,
      },
    });

    const response = await this.bedrockClient.send(command);

    // Handle tool calls if present
    if (response.output?.message?.content) {
      for (const content of response.output.message.content) {
        if (content.toolUse?.name) {
          const toolResult = await this.executeMCPTool(
            content.toolUse.name,
            content.toolUse.input,
          );

          // You can now send the tool result back to Bedrock
          console.log("Tool result:", toolResult);
        }
      }
    }

    return response;
  }

  private async executeMCPTool(toolName: string, input: any) {
    try {
      if (!this.mcpClient) {
        throw new Error("Not initialized.");
      }
      const result = await this.mcpClient.callTool({
        name: toolName,
        arguments: input,
      });
      return result;
    } catch (error) {
      console.error(`Error executing MCP tool ${toolName}:`, error);
      throw error;
    }
  }

  async disconnect() {
    if (this.mcpClient) {
      await this.mcpClient.close();
    }
  }

  async handleToolConversation(
    userMessage: string,
    modelId: string = DEFAULT_MODEL_ID,
  ) {
    const tools = await this.getAvailableTools();

    this.messages.push({
      role: "user" as const,
      content: [{ text: userMessage }],
    });

    while (true) {
      const command = new ConverseCommand({
        modelId,
        messages: this.messages.all(),
        toolConfig: { tools },
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
