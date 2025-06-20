import type { Result } from "./SimpleMcpClientTypes";

/* eslint-disable no-unused-vars */
export interface IMCPIntegration {
  transformToolsFn(tools: any[]): any;
  handleToolConversation(userMessage: string, modelId?: string): any;
  handleToolConversationStream(userMessage: string, modelId?: string): any;
  initialize(): void;
  connectToServers(): void;
  disconnect(): void;
  executeMCPTool(toolName: string, input: any): Promise<Result>;
}
