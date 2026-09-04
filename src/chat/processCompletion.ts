import { QPTool, ToolExecutionContext, Chat, ChatMessage, CompletionRequest } from "./types";
import { AVAILABLE_MODELS } from "./availableModels";
import { parseCompletionStream } from "./parseCompletionStream";
import {
  COMPLETION_URL,
  buildCompletionHeaders,
  describeCompletionError,
  isUsingOwnOpenRouterKey,
} from "./completionApi";

// Retry configuration for rate limit errors
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 10000; // 10 seconds (rate limit is 10 req/min)

// Maximum number of consecutive tool call rounds allowed for a single user
// message, so a model stuck in a propose/reject/retry loop cannot run forever
const MAX_TOOL_CALL_ROUNDS = 10;

/**
 * Sleep for a given number of milliseconds
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if an error is a rate limit error
 */
const isRateLimitError = (status: number, errorMessage: string): boolean => {
  return status === 429 || errorMessage.toLowerCase().includes("rate limit");
};

const processCompletion = async (
  chat: Chat,
  onPartialResponse: (messages: ChatMessage[]) => void,
  tools: QPTool[],
  initialSystemMessage: string,
  toolExecutionContext: ToolExecutionContext,
  signal?: AbortSignal,
  round: number = 0,
): Promise<ChatMessage[]> => {
  const request: CompletionRequest = {
    model: chat.model,
    systemMessage: initialSystemMessage,
    messages: chat.messages,
    tools: tools.map((tool) => ({
      type: "function",
      function: tool.toolFunction,
    })),
    app: "dandiset-metadata-assistant",
  };

  const headers = buildCompletionHeaders();

  // Fetch with retry logic for rate limit errors
  let response: Response | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(COMPLETION_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal,
      });

      if (response.ok) {
        break; // Success, exit retry loop
      }

      // Try to get detailed error message from response body
      let errorDetails = response.statusText || `HTTP ${response.status}`;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          // Try to parse as JSON for structured error
          try {
            const errorJson = JSON.parse(errorBody);
            errorDetails = errorJson.error?.message || errorJson.message || errorJson.error || errorBody;
          } catch {
            // Not JSON, use raw text
            errorDetails = errorBody;
          }
        }
      } catch {
        // Couldn't read body, stick with statusText
      }

      // Check if this is a rate limit error and we should retry
      if (isRateLimitError(response.status, errorDetails) && attempt < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Rate limit hit, retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);

        // Update partial response to show waiting message
        onPartialResponse([
          {
            role: "assistant",
            content: `⏳ Rate limit reached. Waiting ${Math.round(delayMs / 1000)} seconds before retrying (attempt ${attempt + 1}/${MAX_RETRIES})...`,
            model: chat.model,
            usage: { promptTokens: 0, completionTokens: 0, estimatedCost: 0 },
            transient: true,
          },
        ]);

        await sleep(delayMs);
        continue; // Retry
      }

      // Not a rate limit error or out of retries
      lastError = new Error(
        describeCompletionError(
          response.status,
          errorDetails,
          isUsingOwnOpenRouterKey(),
        ),
      );
      break;
    } catch (err) {
      // Network error or abort
      if (err instanceof Error && err.name === "AbortError") {
        throw err; // Don't retry aborted requests
      }
      lastError = err instanceof Error ? err : new Error(String(err));

      // Only retry network errors if we have retries left
      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Network error, retrying in ${delayMs / 1000}s...`);
        await sleep(delayMs);
        continue;
      }
      break;
    }
  }

  if (lastError) {
    throw lastError;
  }

  if (!response || !response.ok) {
    throw new Error("Failed to get response from API");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const { assistantContent, toolCalls, promptTokens, completionTokens } =
    await parseCompletionStream(reader, (content) => {
      onPartialResponse([
        {
          role: "assistant",
          content,
          model: chat.model,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            estimatedCost: 0,
          },
        },
      ]);
    });

  const ret: ChatMessage[] = [];

  if (toolCalls) {
    if (round >= MAX_TOOL_CALL_ROUNDS) {
      // Drop the tool calls rather than executing them. The assistant message is
      // kept for any text it carried, but without tool_calls, because an
      // assistant message with tool_calls and no matching tool results is
      // rejected by OpenAI-style APIs on the next turn.
      if (assistantContent) {
        ret.push({
          role: "assistant",
          content: assistantContent,
          model: chat.model,
          usage: {
            promptTokens,
            completionTokens,
            estimatedCost: getEstimatedCostForModel(chat.model, promptTokens, completionTokens),
          },
        });
      }
      ret.push({
        role: "assistant",
        content: `Reached the limit of ${MAX_TOOL_CALL_ROUNDS} tool call rounds for this message. Send another message if you would like me to continue.`,
        model: chat.model,
        usage: { promptTokens: 0, completionTokens: 0, estimatedCost: 0 },
      });
      onPartialResponse([...ret]);
      return ret;
    }

    ret.push({
      role: "assistant",
      content: assistantContent,
      tool_calls: toolCalls,
      model: chat.model,
      usage: {
        promptTokens,
        completionTokens,
        estimatedCost: getEstimatedCostForModel(
          chat.model,
          promptTokens,
          completionTokens,
        ),
      },
    });
    onPartialResponse([...ret]);

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") {
        throw new Error("Unexpected tool call type: " + toolCall.type);
      }
      const toolCallId = toolCall.id;
      const functionName = toolCall.function.name;
      const functionArgs = toolCall.function.arguments;

      // Streamed tool call arguments can arrive incomplete (for example when the
      // completion hits a token limit mid call, leaving something like "{"), so
      // return an error result the model can react to rather than failing the
      // whole request
      let functionArgsParsed: unknown;
      try {
        functionArgsParsed = JSON.parse(functionArgs || "{}");
      } catch {
        console.warn(`Invalid JSON arguments for tool "${functionName}":`, functionArgs);
        ret.push({
          role: "tool",
          content: `Error: the arguments for tool "${functionName}" were not valid JSON. The response may have been cut off before the tool call was complete. Please retry, splitting the request into smaller tool calls if it was large.`,
          tool_call_id: toolCallId,
        });
        onPartialResponse([...ret]);
        continue;
      }

      const tool = tools.find((t) => t.toolFunction.name === functionName);
      if (!tool) {
        ret.push({
          role: "tool",
          content: `Error: tool "${functionName}" does not exist. Please use one of the available tools.`,
          tool_call_id: toolCallId,
        });
        onPartialResponse([...ret]);
        continue;
      }

      console.info(`Executing tool: ${functionName} with args:`, functionArgsParsed);
      let result: string;
      let newMessages: ChatMessage[] | undefined;
      try {
        const a = await tool.execute(
          functionArgsParsed,
          toolExecutionContext,
        );
        result = a.result;
        newMessages = a.newMessages;
      } catch (err) {
        console.warn(`Error executing tool "${functionName}":`, err);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error executing tool";
        const errorContent = `Error executing tool "${functionName}": ${errorMessage}`;
        ret.push({
          role: "tool",
          content: errorContent,
          tool_call_id: toolCallId,
        });
        onPartialResponse([...ret]);
        continue; // Proceed to next tool call
      }

      for (const m of newMessages || []) {
        ret.push(m);
      }
      // Safety net: OpenRouter rejects individual messages over 100000 characters,
      // so truncate any oversized tool result rather than failing the whole request
      const maxToolResultLength = 90000;
      if (result.length > maxToolResultLength) {
        console.warn(
          `Tool result from "${functionName}" is ${result.length} characters; truncating to ${maxToolResultLength}`,
        );
        result =
          result.substring(0, maxToolResultLength) +
          "\n\n[Tool result truncated due to length...]";
      }
      ret.push({
        role: "tool",
        content: result,
        tool_call_id: toolCallId,
      });
      onPartialResponse([...ret]);
    }

    // Recursively process if there were tool calls
    const onPartialResponse2 = (a: ChatMessage[]) => {
      onPartialResponse([...ret, ...a]);
    };
    const x = await processCompletion(
      {
        ...chat,
        messages: [...chat.messages, ...ret],
      },
      onPartialResponse2,
      tools,
      initialSystemMessage,
      toolExecutionContext,
      signal,
      round + 1,
    );

    return [...ret, ...x];
  }

  const estimatedCost = getEstimatedCostForModel(
    chat.model,
    promptTokens,
    completionTokens,
  );

  return [
    {
      role: "assistant",
      content: assistantContent,
      model: chat.model,
      usage: {
        promptTokens,
        completionTokens,
        estimatedCost,
      },
    },
  ];
};

const getEstimatedCostForModel = (
  model: string,
  promptTokens: number,
  completionTokens: number,
): number => {
  for (const m of AVAILABLE_MODELS) {
    if (m.model === model) {
      return (
        (m.cost.prompt * promptTokens + m.cost.completion * completionTokens) /
        1_000_000
      );
    }
  }
  return 0;
};

export default processCompletion;
