/* eslint-disable @typescript-eslint/no-explicit-any */

type ORFunctionCall = {
  name: string;
  arguments: string; // JSON format arguments
};

type ORToolCall = {
  id: string;
  type: "function";
  function: ORFunctionCall;
};

export type ORTextContent = {
  type: "text";
  text: string;
};

type ORImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: string;
  };
};

export type ORContentPart = ORTextContent | ORImageContentPart;

export type ChatMessage =
  | {
      role: "user";
      content: string | ORContentPart[];
    }
  | {
      role: "assistant";
      content: string | ORContentPart[] | null;
      tool_calls?: ORToolCall[];
      model?: string;
      usage?: {
        promptTokens: number;
        completionTokens: number;
        estimatedCost: number;
      };
      // Status-only messages that are shown while a response is in progress but
      // should never become part of the persisted chat history.
      transient?: boolean;
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
      name?: string;
    };

export type Chat = {
  messages: ChatMessage[];
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    estimatedCost: number;
  };
  model: string;
};

export type ORFunctionDescription = {
  description?: string;
  name: string;
  parameters: object; // JSON Schema object
};

export type ORTool = {
  type: "function";
  function: ORFunctionDescription;
};

export type CompletionRequest = {
  model: string;
  systemMessage: string;
  messages: ChatMessage[];
  tools: ORTool[];
  app?: string;
};

export type MetadataOperationType = 'set' | 'delete' | 'insert' | 'append';

export interface ModifyMetadataResult {
  success: boolean;
  error?: string;
}

export interface ToolExecutionContext {
  modifyMetadata: (operation: MetadataOperationType, path: string, value?: unknown) => ModifyMetadataResult;
  originalMetadata: any;
  modifiedMetadata: any;
}

export type QPFunctionDescription = {
  description?: string;
  name: string;
  parameters: object; // JSON Schema object
};

export interface QPTool {
  toolFunction: QPFunctionDescription;
  execute: (
    params: any,
    context: ToolExecutionContext,
  ) => Promise<{ result: string; newMessages?: ChatMessage[] }>;
  getDetailedDescription: () => string;
}
