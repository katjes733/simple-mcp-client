import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

// Transform MCP tool to Bedrock tool format
export function transformMCPToolToBedrock(mcpTool: MCPTool): Tool {
  return {
    toolSpec: {
      name: mcpTool.name,
      description: mcpTool.description,
      inputSchema: {
        json: mcpTool.inputSchema as unknown as any,
      },
    },
  };
}

// Example usage with multiple MCP tools
export function transformMCPToolsToBedrock(mcpTools: MCPTool[]): Tool[] {
  return mcpTools.map(transformMCPToolToBedrock);
}
