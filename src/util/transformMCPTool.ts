import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

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

export function transformMCPToolsToBedrock(mcpTools: MCPTool[]): Tool[] {
  return mcpTools.map(transformMCPToolToBedrock);
}

export function transformMCPToolToOpenAI(mcpTool: MCPTool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: { ...mcpTool.inputSchema, additionalProperties: false },
      strict: true,
    },
  };
}

export function transformMCPToolsToOpenAI(
  mcpTools: MCPTool[],
): ChatCompletionTool[] {
  return mcpTools.map(transformMCPToolToOpenAI);
}
