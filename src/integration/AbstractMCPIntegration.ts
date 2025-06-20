import type { IMCPIntegration } from "~/types/IMCPIntegration";
import type { ServerConfig } from "~/types/SimpleMcpClientTypes";
import { CustomStringMap } from "~/util/CustomStringMap";
import { LimitedSizeArray } from "~/util/LimitedSizeArray";
import { MCPClient } from "~/util/MCPClient";

export abstract class AbstractMCPIntegration<TTool, TMessage>
  implements IMCPIntegration
{
  private mcpClients: MCPClient[] = [];
  private toolsMap = new CustomStringMap<MCPClient>();
  private servers: { [name: string]: ServerConfig } = {};

  tools: TTool[] = [];
  defaultModelId: string;
  typeReasoning: string | undefined;
  messages = new LimitedSizeArray<TMessage>(1024 * 1024);

  constructor(
    defaultModelId: string,
    {
      typeReasoning = process.env.TYPE_REASONING,
    }: {
      typeReasoning: string | undefined;
    } = {
      typeReasoning: process.env.TYPE_REASONING,
    },
  ) {
    this.defaultModelId = defaultModelId;
    this.typeReasoning = typeReasoning;
  }

  /* eslint-disable no-unused-vars */
  abstract transformToolsFn(tools: any[]): TTool[];
  abstract handleToolConversation(
    userMessage: string,
    modelId: string,
  ): Promise<TMessage[]>;
  abstract handleToolConversationStream(
    userMessage: string,
    modelId: string,
  ): Promise<TMessage[]>;
  /* eslint-enable no-unused-vars */

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
        this.tools = [...this.tools, ...this.transformToolsFn(tools)];
        this.toolsMap.mergeFrom(map);
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

  async executeMCPTool(toolName: string, input: any) {
    try {
      const entry = this.toolsMap.getEntry(toolName);
      if (!entry) throw new Error(`Cannot find tool '${toolName}.`);
      const [actualToolName, mcpClient] = entry;
      const result = await mcpClient.callTool(actualToolName, input);
      return result;
    } catch (error) {
      typewriter.error(`Error executing MCP tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Accumulates all delta objects field values into the target object.
   * Strings are concatenated by default.
   *
   * @param target The target object.
   * @param delta The delta object.
   */
  accumulate(target: any, delta: any) {
    for (const key in delta) {
      if (typeof delta[key] === "string") {
        target[key] = (target[key] || "") + delta[key];
      } else if (Array.isArray(delta[key])) {
        target[key] = target[key] || [];
        delta[key].forEach((item: any, idx: number) => {
          target[key][idx] = target[key][idx] || {};
          this.accumulate(target[key][idx], item);
        });
      } else if (typeof delta[key] === "object" && delta[key] !== null) {
        target[key] = target[key] || {};
        this.accumulate(target[key], delta[key]);
      } else {
        target[key] = delta[key];
      }
    }
  }

  /* eslint-disable no-unused-vars */
  parseJsonSafely(
    text: string,
    reviver?: (this: any, key: string, value: any) => any,
  ) {
    /* eslint-enable no-unused-vars */
    if (!text) return {};
    try {
      return JSON.parse(text, reviver);
    } catch (error) {
      typewriter.error(error);
      return {};
    }
  }
}
