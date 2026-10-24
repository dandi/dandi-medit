import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  ReasoningEffort,
} from "./availableModels";

const OPENROUTER_API_KEY_STORAGE_KEY = "openrouter_api_key";

export const getStoredOpenRouterApiKey = (): string | null => {
  try {
    return localStorage.getItem(OPENROUTER_API_KEY_STORAGE_KEY);
  } catch (error) {
    console.error("Error reading OpenRouter API key from localStorage:", error);
    return null;
  }
};

export const setStoredOpenRouterApiKey = (apiKey: string): void => {
  try {
    localStorage.setItem(OPENROUTER_API_KEY_STORAGE_KEY, apiKey);
  } catch (error) {
    console.error("Error saving OpenRouter API key to localStorage:", error);
  }
};

export const clearStoredOpenRouterApiKey = (): void => {
  try {
    localStorage.removeItem(OPENROUTER_API_KEY_STORAGE_KEY);
  } catch (error) {
    console.error("Error clearing OpenRouter API key from localStorage:", error);
  }
};

const MODEL_STORAGE_KEY = "openrouter_model";

export const getStoredModel = (): string | null => {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch (error) {
    console.error("Error reading model from localStorage:", error);
    return null;
  }
};

export const setStoredModel = (model: string): void => {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch (error) {
    console.error("Error saving model to localStorage:", error);
  }
};

const REASONING_EFFORT_STORAGE_KEY = "reasoning_effort";

export const getStoredReasoningEffort = (): ReasoningEffort => {
  try {
    const stored = localStorage.getItem(REASONING_EFFORT_STORAGE_KEY);
    if (stored && REASONING_EFFORTS.includes(stored as ReasoningEffort)) {
      return stored as ReasoningEffort;
    }
  } catch (error) {
    console.error("Error reading reasoning effort from localStorage:", error);
  }
  return DEFAULT_REASONING_EFFORT;
};

export const setStoredReasoningEffort = (effort: ReasoningEffort): void => {
  try {
    localStorage.setItem(REASONING_EFFORT_STORAGE_KEY, effort);
  } catch (error) {
    console.error("Error saving reasoning effort to localStorage:", error);
  }
};

export const maskApiKey = (apiKey: string): string => {
  if (!apiKey || apiKey.length < 8) {
    return "***";
  }
  return `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`;
};
