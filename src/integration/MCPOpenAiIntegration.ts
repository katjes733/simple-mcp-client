import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ServerConfig } from "~/types/SimpleMcpClientTypes";
import { LimitedSizeArray } from "~/util/LimitedSizeArray";
import { MCPClient } from "~/util/MCPClient";
import { transformMCPToolsToOpenAI } from "~/util/transformMCPTool";

const DEFAULT_MODEL_ID = "gpt-4o";

export class MCPOpenAiIntegration {
  private openai: OpenAI;
  private defaultModelId: string;
  private typeReasoning: string | undefined;
  private messages = new LimitedSizeArray<ChatCompletionMessageParam>(
    1024 * 1024,
  );

  private mcpClients: MCPClient[] = [];
  private tools: ChatCompletionTool[] = [];
  private toolsMap: { [name: string]: MCPClient } = {};
  private servers: { [name: string]: ServerConfig } = {};

  constructor(
    {
      openaiApiKey = process.env.OPENAI_API_KEY,
      defaultModelId = DEFAULT_MODEL_ID,
      typeReasoning = process.env.TYPE_REASONING,
    }: {
      openaiApiKey: string | undefined;
      defaultModelId: string;
      typeReasoning: string | undefined;
    } = {
      openaiApiKey: process.env.OPENAI_API_KEY,
      defaultModelId: DEFAULT_MODEL_ID,
      typeReasoning: process.env.TYPE_REASONING,
    },
  ) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.defaultModelId = defaultModelId;
    this.typeReasoning = typeReasoning;
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
        this.tools = [...this.tools, ...transformMCPToolsToOpenAI(tools)];
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
    // const systemPrompt = `
    //   You are an assistant with access to tools.
    //   Always provide imperial values for metric values returned.
    //   When you decide to call a tool you MUST:
    //   1. Write one sentence in field "content" that starts with "THOUGHT:" explaining why.
    //   2. Provide the tool_call JSON.
    // `;
    // this.messages.push({
    //   role: "system" as const,
    //   content: [{ text: systemPrompt, type: "text" }],
    // });
    this.messages.push({
      role: "user" as const,
      content: [{ text: userMessage, type: "text" }],
    });

    while (true) {
      const startTime = performance.now();
      const completion = await this.openai.chat.completions.create({
        model: modelId,
        messages: this.messages.all(),
        tools: this.tools,
        tool_choice: "auto",
      });

      const msg = completion.choices[0].message;

      this.messages.push(msg);
      if (!msg.tool_calls?.length) {
        typewriter.log(
          "Latency for final response in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
        typewriter.type(msg.content, "\n");
        break;
      }

      typewriter.log(
        "Latency for tool choice in ms:",
        Number((performance.now() - startTime).toFixed(0)),
      );
      if (this.typeReasoning === "true" && msg.content) {
        typewriter.type(msg.content, "\n");
      }

      if (msg.tool_calls) {
        for (const call of msg.tool_calls) {
          const toolStartTime = performance.now();
          const result = await this.executeMCPTool(
            call.function.name,
            JSON.parse(call.function.arguments),
          );
          try {
            typewriter.log("Result:", JSON.parse(result.content[0].text));
          } catch {
            typewriter.log("Result:", result.content[0].text);
          }
          const toolReply = {
            role: "tool" as const,
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(result),
          };
          this.messages.push(toolReply);
          typewriter.log(
            `Latency for tool invocation '${call.function.name || "N/A"}' in ms:`,
            Number((performance.now() - toolStartTime).toFixed(0)),
          );
        }
      }
      // ↻ loop – the LLM now sees fresh tool results and can pick another
    }
  }

  async handleToolConversationStream(
    userMessage: string,
    // eslint-disable-next-line no-unused-vars
    modelId: string = this.defaultModelId,
  ) {
    throw new Error("Streaming is not yet implemented for OpenAI integration");
  }
}
