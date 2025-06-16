import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { transformMCPToolsToBedrock } from "~/util/transformMCPTool";
import type { Message } from "~/types/SimpleMcpClientTypes";
import type { Tool, ToolUseBlock } from "@aws-sdk/client-bedrock-runtime";
import { AbstractMCPIntegration } from "./AbstractIntegration";

const DEFAULT_MODEL_ID =
  "arn:aws:bedrock:us-east-1:275279264324:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0";
// const DEFAULT_MODEL_ID = "amazon.nova-micro-v1:0";
const DEFAULT_REGION = "us-east-1";

export class MCPBedrockIntegration extends AbstractMCPIntegration<
  Tool,
  Message
> {
  private bedrockClient: BedrockRuntimeClient;

  constructor(
    {
      profile = process.env.AWS_PROFILE,
      region = DEFAULT_REGION,
    }: {
      profile: string | undefined;
      region: string;
    } = {
      profile: process.env.AWS_PROFILE,
      region: DEFAULT_REGION,
    },
  ) {
    super(DEFAULT_MODEL_ID);
    this.bedrockClient = new BedrockRuntimeClient({ region, profile });
  }

  transformToolsFn(tools: any[]): Tool[] {
    return transformMCPToolsToBedrock(tools);
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
      const startTime = performance.now();
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

      // Check if model wants to use tools
      const toolUses = message.content?.filter((c) => c.toolUse) || [];

      if (toolUses.length === 0) {
        typewriter.log(
          "Latency for final response in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
        if (message.content && message.content.length > 0) {
          typewriter.type(message.content[0].text, "\n");
        }
        break;
      }

      typewriter.log(
        "Latency for tool choice in ms:",
        Number((performance.now() - startTime).toFixed(0)),
      );

      if (
        this.typeReasoning === "true" &&
        message.content &&
        message.content.length > 0
      ) {
        typewriter.type(message.content[0].text + "\n");
      }

      const toolResults = [];
      for (const toolUse of toolUses) {
        if (toolUse.toolUse) {
          try {
            const toolStartTime = performance.now();
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
            typewriter.log(
              `Latency for tool invocation '${toolUse.toolUse.name || "N/A"}' in ms:`,
              Number((performance.now() - toolStartTime).toFixed(0)),
            );
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
      const startTime = performance.now();
      const command = new ConverseStreamCommand({
        modelId,
        messages: this.messages.all(),
        toolConfig: { tools: this.tools },
      });

      const response = await this.bedrockClient.send(command);
      if (!response.stream) break;
      let toolUse: ToolUseBlock = { toolUseId: "", name: "", input: "" };
      let text = "";
      let firstChunk = true;
      for await (const chunk of response.stream) {
        if (firstChunk) {
          typewriter.log(
            "Latency for bedrock invocation (stream start) in ms:",
            Number((performance.now() - startTime).toFixed(0)),
          );
          firstChunk = false;
        }
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
      }

      if (!toolUse || !toolUse.toolUseId || !toolUse.name || !toolUse.input) {
        typewriter.log(
          "Latency for final response (stream end) in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
        break;
      } else {
        typewriter.log(
          "Latency for tool choice (stream end) in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
      }

      let parsedInput: any;
      if (typeof toolUse.input === "string") {
        parsedInput = toolUse.input ? this.parseJsonSafely(toolUse.input) : {};
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
          parsedInput = toolUse.input
            ? this.parseJsonSafely(toolUse.input)
            : {};
        } else {
          parsedInput = toolUse.input ?? {};
        }
        const toolStartTime = performance.now();
        const result = await this.executeMCPTool(toolUse.name, parsedInput);
        try {
          typewriter.log("Result:", JSON.parse(result.content[0].text));
        } catch {
          typewriter.log("Result:", result.content[0].text);
        }
        typewriter.log(
          `Latency for tool invocation '${toolUse.name || "N/A"}' in ms:`,
          Number((performance.now() - toolStartTime).toFixed(0)),
        );
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
