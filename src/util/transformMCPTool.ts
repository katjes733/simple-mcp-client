import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type {
  FunctionDeclarationSchema,
  Tool as GoogleAiTool,
} from "@google-cloud/vertexai";

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
  // Workaround to fix a bug in openai that does not support optional MCP Tool parameters
  const inputSchema = { ...mcpTool.inputSchema };
  if (inputSchema.properties) {
    inputSchema.required = Object.keys(inputSchema.properties);
  }
  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: { ...inputSchema, additionalProperties: false },
      strict: true,
    },
  };
}

export function transformMCPToolsToOpenAI(
  mcpTools: MCPTool[],
): ChatCompletionTool[] {
  return mcpTools.map(transformMCPToolToOpenAI);
}

export function transformMCPToolToGoogleAI(mcpTool: MCPTool): any {
  const parameters = {
    ...mcpTool.inputSchema,
  } as unknown as FunctionDeclarationSchema;
  return {
    name: mcpTool.name,
    description: mcpTool.description,
    parameters,
  };
}

export function transformMCPToolsToGoogleAI(
  mcpTools: MCPTool[],
): GoogleAiTool[] {
  return [{ functionDeclarations: mcpTools.map(transformMCPToolToGoogleAI) }];
}
