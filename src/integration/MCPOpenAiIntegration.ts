import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { transformMCPToolsToOpenAI } from "~/util/transformMCPTool";
import { AbstractMCPIntegration } from "./AbstractIntegration";

const DEFAULT_MODEL_ID = "gpt-4o";

export class MCPOpenAiIntegration extends AbstractMCPIntegration<
  ChatCompletionTool,
  ChatCompletionMessageParam
> {
  private openai: OpenAI;

  constructor(
    {
      openaiApiKey = process.env.OPENAI_API_KEY,
    }: {
      openaiApiKey: string | undefined;
    } = {
      openaiApiKey: process.env.OPENAI_API_KEY,
    },
  ) {
    super(DEFAULT_MODEL_ID);
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  transformToolsFn(tools: any[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return transformMCPToolsToOpenAI(tools);
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
            this.parseJsonSafely(call.function.arguments),
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

    typewriter.log("Memory size in bytes:", this.messages.getTotalSize());

    return this.messages.all();
  }

  async handleToolConversationStream(
    userMessage: string,
    modelId: string = this.defaultModelId,
  ) {
    this.messages.push({
      role: "user" as const,
      content: [{ text: userMessage, type: "text" }],
    });

    while (true) {
      let currentMsg: ChatCompletionChunk.Choice.Delta = {};
      let toolCallResults: any[] = [];

      const startTime = performance.now();

      const stream = await this.openai.chat.completions.create({
        model: modelId,
        messages: this.messages.all(),
        tools: this.tools,
        tool_choice: "auto",
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0].delta;
        if (!Object.keys(currentMsg).length) {
          if (delta.tool_calls?.length) {
            typewriter.log(
              "Latency for tool choice (stream start) in ms:",
              Number((performance.now() - startTime).toFixed(0)),
            );
          } else {
            typewriter.log(
              "Latency for final response (stream start) in ms:",
              Number((performance.now() - startTime).toFixed(0)),
            );
          }
        }
        this.accumulate(currentMsg, delta);

        // Type any delta content
        if (delta.content) {
          typewriter.type(delta.content);
        }
      }

      this.messages.push(currentMsg as unknown as ChatCompletionMessageParam);

      if (currentMsg.tool_calls?.length) {
        typewriter.log(
          "Latency for tool choice (stream end) in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
      } else {
        typewriter.type("\n");
        typewriter.log(
          "Latency for final response (stream end) in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
        break;
      }

      if (currentMsg.tool_calls) {
        // For each tool call, execute and push tool reply
        for (const toolCall of currentMsg.tool_calls) {
          if (
            !toolCall.function ||
            typeof toolCall.function.name !== "string"
          ) {
            typewriter.error(
              "Tool call function or function name is undefined:",
              toolCall,
            );
            continue;
          }
          const toolStartTime = performance.now();
          const result = await this.executeMCPTool(
            toolCall.function.name,
            this.parseJsonSafely(toolCall.function.arguments ?? "{}"),
          );
          try {
            typewriter.log("Result:", JSON.parse(result.content[0].text));
          } catch {
            typewriter.log("Result:", result.content[0].text);
          }
          const toolReply = {
            role: "tool" as const,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify(result.content),
          };
          this.messages.push(
            toolReply as unknown as ChatCompletionMessageParam,
          );
          typewriter.log(
            `Latency for tool invocation '${toolCall.function.name || "N/A"}' in ms:`,
            Number((performance.now() - toolStartTime).toFixed(0)),
          );
          toolCallResults.push(toolReply);
        }
      }
    }

    typewriter.log("Memory size in bytes:", this.messages.getTotalSize());

    return this.messages.all();
  }
}
