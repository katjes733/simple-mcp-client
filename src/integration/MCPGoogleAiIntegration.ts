import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  VertexAI,
  type Tool,
  type Part,
  type Content,
} from "@google-cloud/vertexai";
import { AbstractMCPIntegration } from "./AbstractMCPIntegration";
import { transformMCPToolsToGoogleAI } from "~/util/transformMCPTool";

const DEFAULT_MODEL_ID = "gemini-2.5-flash";

export class MCPGoogleAiIntegration extends AbstractMCPIntegration<
  Tool,
  Content
> {
  private googleAi: GoogleGenerativeAI | VertexAI;

  constructor(
    {
      googleAiKey = process.env.GOOGLE_AI_KEY,
    }: {
      googleAiKey: string | undefined;
    } = {
      googleAiKey: process.env.GOOGLE_AI_KEY,
    },
  ) {
    super(DEFAULT_MODEL_ID);
    if (!googleAiKey) throw new Error("No Google AI Key specified.");
    if (googleAiKey?.startsWith("AIzaSy")) {
      this.googleAi = new GoogleGenerativeAI(googleAiKey);
    } else {
      this.googleAi = new VertexAI({
        project: googleAiKey,
        location: "us-central1",
      });
    }
  }

  transformToolsFn(tools: any[]): Tool[] {
    return transformMCPToolsToGoogleAI(tools);
  }

  async handleToolConversation(
    userMessage: string,
    modelId: string = this.defaultModelId,
  ): Promise<any[]> {
    const model = this.googleAi.getGenerativeModel({ model: modelId });
    this.messages.push({
      role: "user" as const,
      parts: [{ text: userMessage }],
    });
    while (true) {
      const startTime = performance.now();

      const { response } = await model.generateContent({
        contents: this.messages.all(),
        tools: this.tools,
      });

      const candidate = response!.candidates![0];

      this.messages.push({
        role: candidate.content.role,
        parts: candidate.content.parts as unknown as Part[],
      });

      // Check if model wants to use tools
      const toolUses = candidate.content.parts.filter(
        (part) => part.functionCall,
      ) as Part[];

      if (!toolUses.length) {
        typewriter.log(
          "Latency for final response in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
        typewriter.type(candidate.content?.parts?.[0].text, "\n");
        break;
      }

      typewriter.log(
        "Latency for tool choice in ms:",
        Number((performance.now() - startTime).toFixed(0)),
      );

      if (this.typeReasoning === "true" && candidate.content?.parts?.[0].text) {
        typewriter.type(candidate.content?.parts?.[0].text, "\n");
      }

      await this.executeTools(toolUses);
    }

    typewriter.log("Memory size in bytes:", this.messages.getTotalSize());

    return this.messages.all();
  }

  async handleToolConversationStream(
    userMessage: string,
    modelId: string = this.defaultModelId,
  ): Promise<any[]> {
    const model = this.googleAi.getGenerativeModel({ model: modelId });
    this.messages.push({
      role: "user" as const,
      parts: [{ text: userMessage }],
    });

    while (true) {
      let currentMsg: Content = {} as unknown as Content;
      const startTime = performance.now();

      const { stream } = await model.generateContentStream({
        contents: this.messages.all(),
        tools: this.tools,
      });

      for await (const item of stream) {
        const delta = item!.candidates![0].content;
        if (!Object.keys(currentMsg).length) {
          if (delta.parts.some((part) => "functionCall" in part)) {
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
        const text = delta.parts.find((p) => "text" in p)?.text;
        if (text) {
          typewriter.type(text);
        }
      }

      this.messages.push(currentMsg);

      // Check if model wants to use tools
      const toolUses = currentMsg.parts.filter((part) => part.functionCall);

      if (!toolUses.length) {
        typewriter.type("\n");
        typewriter.log(
          "Latency for final response (stream end) in ms:",
          Number((performance.now() - startTime).toFixed(0)),
        );
        break;
      }

      typewriter.log(
        "Latency for tool choice (stream end) in ms:",
        Number((performance.now() - startTime).toFixed(0)),
      );

      await this.executeTools(toolUses);
    }

    typewriter.log("Memory size in bytes:", this.messages.getTotalSize());

    return this.messages.all();
  }

  private async executeTools(toolUses: Part[]) {
    for (const toolUse of toolUses) {
      if (toolUse.functionCall) {
        try {
          const toolStartTime = performance.now();
          if (!toolUse.functionCall.name) {
            throw new Error("Tool name is undefined.");
          }
          const result = await this.executeMCPTool(
            toolUse.functionCall.name,
            toolUse.functionCall.args,
          );
          try {
            typewriter.log("Result:", JSON.parse(result.content[0].text));
          } catch {
            typewriter.log("Result:", result.content[0].text);
          }

          // Add tool results to conversation
          this.messages.push({
            role: "tool",
            parts: [
              {
                functionResponse: {
                  name: toolUse.functionCall.name,
                  response: result,
                },
              },
            ],
          });
          typewriter.log(
            `Latency for tool invocation '${toolUse.functionCall.name || "N/A"}' in ms:`,
            Number((performance.now() - toolStartTime).toFixed(0)),
          );
        } catch (error) {
          this.messages.push({
            role: "tool",
            parts: [
              {
                functionResponse: {
                  name: toolUse.functionCall.name,
                  response: {
                    error: `Error: ${error instanceof Error ? error.message : String(error)}`,
                  },
                },
              },
            ],
          });
        }
      }
    }
  }
}
