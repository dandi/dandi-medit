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

export type ORMessage =
  | {
      role: "user" | "assistant" | "system";
      content: string | ORContentPart[];
      name?: string;
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
      name?: string;
    }
  | {
      role: "assistant";
      content: null;
      tool_calls: ORToolCall[];
    };

export type ORFunctionDescription = {
  description?: string;
  name: string;
  parameters: object;
};

export type ORTool = {
  type: "function";
  function: ORFunctionDescription;
};

export type ORToolChoice =
  | "none"
  | "auto"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

export type ORResponse = {
  id: string;
  choices: (ORNonStreamingChoice | ORStreamingChoice | ORNonChatChoice)[];
  created: number;
  model: string;
  object: "chat.completion" | "chat.completion.chunk";
  system_fingerprint?: string;
  usage?: ORResponseUsage;
};

type ORResponseUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ORNonChatChoice = {
  finish_reason: string | null;
  text: string;
  error?: Error;
};

export type ORNonStreamingChoice = {
  finish_reason: string | null;
  message: {
    content: string | null;
    role: string;
    tool_calls?: ORToolCall[];
    function_call?: ORFunctionCall;
  };
  error?: Error;
};

export type ORStreamingChoice = {
  finish_reason: string | null;
  delta: {
    content: string | null;
    role?: string;
    tool_calls?: ORToolCall[];
    function_call?: ORFunctionCall;
  };
  error?: Error;
};

export type ORError = {
  code: number;
  message: string;
};

type ORFunctionCall = {
  name: string;
  arguments: string;
};

export type ORToolCall = {
  id: string;
  type: "function";
  function: ORFunctionCall;
};
