import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Result, ServerConfig } from "~/types/SimpleMcpClientTypes";

export class MCPClient {
  private client: Client;
  private serverName: string;
  private transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | null = null;

  constructor(serverName: string) {
    this.serverName = serverName;
    this.client = new Client({
      name: `mcp-client-for-${serverName}`,
      version: "1.0.0",
    });
  }

  async connectToServer(serverConfig: ServerConfig) {
    if (serverConfig.serverUrl) {
      this.transport = new StreamableHTTPClientTransport(
        new URL(serverConfig.serverUrl),
      );
    } else if (serverConfig.command) {
      this.transport = new StdioClientTransport({
        command:
          serverConfig.command === "bun"
            ? process.execPath
            : serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      });
    } else {
      throw new Error(
        `Must specify either a command (stdio) or a serverUrl (streaming HTTP) for server ${this.serverName}`,
      );
    }
    await this.client.connect(this.transport);
  }

  async getTools(): Promise<Tool[]> {
    const tools = await this.client.listTools();
    return tools.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Result> {
    const result = await this.client.callTool({
      name: name,
      arguments: args,
    });
    // Map the result to match the Result type
    return {
      content: (Array.isArray(result.content) ? result.content : []).map(
        (item: any) => {
          if (item.type === "text") {
            return {
              type: item.type,
              text: item.text,
              ...(item.annotations && { annotations: item.annotations }),
            };
          } else {
            // For non-text types, provide a fallback text value
            return {
              type: item.type,
              text: "",
              ...(item.annotations && { annotations: item.annotations }),
            };
          }
        },
      ),
    };
  }

  async disconnect() {
    await this.client.close();
  }
}
