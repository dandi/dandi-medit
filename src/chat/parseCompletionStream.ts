/* eslint-disable @typescript-eslint/no-explicit-any */
import { ORResponse, ORToolCall } from "./openRouterTypes";

export interface StreamParseResult {
  assistantContent: string;
  toolCalls: ORToolCall[] | undefined;
  promptTokens: number;
  completionTokens: number;
}

export const parseCompletionStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunkProcessed?: (assistantContent: string) => void,
): Promise<StreamParseResult> => {
  let assistantContent = "";
  let toolCalls: ORToolCall[] | undefined = undefined;

  let promptTokens = 0;
  let completionTokens = 0;

  // One decoder for the whole stream, used in streaming mode, so that a
  // multi-byte UTF-8 character split across two chunks is decoded correctly
  // rather than as replacement characters
  const decoder = new TextDecoder("utf-8");
  // Text after the last newline of the most recent chunk, carried over so
  // that an SSE line spanning a chunk boundary is not lost
  let buffer = "";
  let finished = false;

  // Handle one complete SSE line. Returns true when the stream signals [DONE].
  const processLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) return false;
    const data = trimmed.slice("data: ".length).trim();
    if (data === "[DONE]") return true;
    try {
      let parsed;
      try {
        parsed = JSON.parse(data) as ORResponse;
      } catch (e) {
        console.warn(data);
        throw e;
      }
      const choice = parsed.choices[0];
      if (choice && "delta" in choice) {
        const delta = choice.delta;
        if (delta.content) {
          assistantContent += delta.content;
          if (onChunkProcessed) {
            onChunkProcessed(assistantContent);
          }
        }
        if (delta.tool_calls) {
          toolCalls = applyDeltaToToolCalls(toolCalls, delta.tool_calls);
        }
      }
      if (parsed.usage) {
        promptTokens += parsed.usage.prompt_tokens || 0;
        completionTokens += parsed.usage.completion_tokens || 0;
      }
    } catch (e) {
      console.error("Error parsing chunk:", e);
    }
    return false;
  };

  // Process every complete line in the buffer and keep the trailing partial
  // line for the next chunk
  const processBufferedLines = () => {
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (processLine(line)) {
        finished = true;
        return;
      }
    }
  };

  while (!finished) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      processBufferedLines();
    }
    if (done) break;
  }

  // Flush any bytes the decoder is still holding and handle a final line that
  // was not terminated by a newline
  if (!finished) {
    buffer += decoder.decode();
    if (buffer !== "") {
      processLine(buffer);
    }
  }

  return {
    assistantContent,
    toolCalls,
    promptTokens,
    completionTokens,
  };
};

export const applyDeltaToToolCalls = (
  current: ORToolCall[] | undefined,
  delta: any[],
): ORToolCall[] => {
  if (!current) {
    current = [];
  }

  for (const deltaToolCall of delta) {
    const index = deltaToolCall.index;

    if (index >= current.length) {
      current.push({
        id: deltaToolCall.id || "",
        type: deltaToolCall.type,
        function: {
          name: deltaToolCall.function.name || "",
          arguments: deltaToolCall.function.arguments || "",
        },
      });
    } else {
      const existingToolCall = current[index];

      if (deltaToolCall.id) {
        existingToolCall.id = deltaToolCall.id;
      }

      if (deltaToolCall.function.name) {
        existingToolCall.function.name = deltaToolCall.function.name;
      }

      if (deltaToolCall.function.arguments) {
        existingToolCall.function.arguments += deltaToolCall.function.arguments;
      }
    }
  }

  return current;
};
