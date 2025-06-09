import {
  ContentBlock,
  ConversationRole,
} from "@aws-sdk/client-bedrock-runtime";

export type ServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, any>;
};

export type Message = {
  role: ConversationRole;
  content: ContentBlock[];
};

export type Result = {
  content: {
    type: string;
    text: string;
    annotations?: Record<string, any>;
  }[];
};
