import type { ExtensionSettings } from "./settings";

export interface ExtensionState {
  settings: ExtensionSettings;
  hasApiKey: boolean;
}

export type ExtensionMessage =
  | { type: "GET_EXTENSION_STATE" }
  | { type: "VALIDATE_AND_SAVE_API_KEY"; apiKey: string }
  | { type: "DELETE_API_KEY" }
  | { type: "UPDATE_SETTINGS"; settings: ExtensionSettings }
  | { type: "CLASSIFY_TWEET"; requestId: string; content: string }
  | { type: "CANCEL_CLASSIFICATIONS" };

export type ExtensionResponse =
  | { ok: true; state?: ExtensionState; score?: number }
  | { ok: false; error: string; code?: "BUSY" | "CANCELLED" | "INACTIVE" };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;

  const type = (value as { type?: unknown }).type;
  return (
    type === "GET_EXTENSION_STATE" ||
    type === "VALIDATE_AND_SAVE_API_KEY" ||
    type === "DELETE_API_KEY" ||
    type === "UPDATE_SETTINGS" ||
    type === "CLASSIFY_TWEET" ||
    type === "CANCEL_CLASSIFICATIONS"
  );
}
