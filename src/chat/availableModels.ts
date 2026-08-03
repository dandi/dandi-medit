export const AVAILABLE_MODELS = [
  {
    model: "openai/gpt-4.1-mini",
    label: "gpt-4.1-mini",
    cost: {
      prompt: 0.4,
      completion: 1.6,
    },
  },
  {
    model: "openai/gpt-5-mini",
    label: "gpt-5-mini",
    cost: {
      prompt: 0.25,
      completion: 2
    }
  },
  {
    model: "openai/gpt-4o-mini",
    label: "gpt-4o-mini",
    cost: {
      prompt: 0.15,
      completion: 0.6,
    },
  },
  {
    model: "openai/gpt-4o",
    label: "gpt-4o",
    cost: {
      prompt: 2.5,
      completion: 10,
    },
  },
  {
    model: "google/gemini-2.5-flash",
    label: "gemini-2.5-flash",
    cost: {
      prompt: 0.3,
      completion: 2.5,
    },
  },
  {
    model: "anthropic/claude-3.5-sonnet",
    label: "claude-3.5-sonnet",
    cost: {
      prompt: 3,
      completion: 15,
    },
  },
  {
    model: "anthropic/claude-sonnet-4",
    label: "claude-sonnet-4",
    cost: {
      prompt: 3,
      completion: 15,
    },
  },
  {
    model: "moonshotai/kimi-k2-thinking",
    label: "kimi-k2-thinking",
    cost: {
      prompt: 0.47,
      completion: 2
    }
  },
  {
    model: "google/gemini-3-flash-preview",
    label: "gemini-3-flash-preview",
    cost: {
      prompt: 0.15,
      completion: 0.6,
    },
  },
  {
    model: "deepseek/deepseek-v4-flash-0731",
    label: "deepseek-v4-flash-0731",
    cost: {
      prompt: 0.09,
      completion: 0.18,
    },
  }
];

// Cheap models that can use server API key
export const CHEAP_MODELS = [
  "openai/gpt-4.1-mini",
  "openai/gpt-5-mini",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash",
  "moonshotai/kimi-k2-thinking",
  "google/gemini-3-flash-preview",
  "deepseek/deepseek-v4-flash-0731"
];

export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
