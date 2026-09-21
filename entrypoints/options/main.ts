import { browser } from "wxt/browser";
import type {
  ExtensionMessage,
  ExtensionResponse,
  ExtensionState,
} from "../../lib/messages";
import { DEFAULT_SETTINGS } from "../../lib/settings";
import "./style.css";

const form = element<HTMLFormElement>("key-form");
const apiKey = element<HTMLInputElement>("api-key");
const saveKey = element<HTMLButtonElement>("save-key");
const deleteKey = element<HTMLButtonElement>("delete-key");
const keyState = element<HTMLElement>("key-state");
const connectionStatus = element<HTMLElement>("connection-status");
const stateDot = element<HTMLElement>("state-dot");
const message = element<HTMLElement>("message");
const customForm = element<HTMLFormElement>("custom-form");
const customQuestion = element<HTMLTextAreaElement>("custom-question");
const customYesCriteria = element<HTMLInputElement>("custom-yes-criteria");
const customNoCriteria = element<HTMLInputElement>("custom-no-criteria");
const customMessage = element<HTMLElement>("custom-message");
let hasApiKey = false;
let currentState: ExtensionState = {
  hasApiKey: false,
  settings: { ...DEFAULT_SETTINGS },
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void replaceKey();
});

deleteKey.addEventListener("click", () => {
  void removeKey();
});

customForm.addEventListener("submit", (event) => event.preventDefault());
customForm.addEventListener("change", () => {
  void saveCustomInput();
});

void loadState();

async function loadState(): Promise<void> {
  const response = await sendMessage({ type: "GET_EXTENSION_STATE" });
  if (!response.ok || !response.state) {
    setMessage(response.ok ? "Could not load extension state." : response.error, true);
    return;
  }

  render(response.state);
}

async function replaceKey(): Promise<void> {
  const value = apiKey.value.trim();
  if (!value) {
    setMessage("Enter a TypeSafe API key.", true);
    return;
  }

  setBusy(true);
  setMessage("Validating with TypeSafe...", false);
  const response = await sendMessage({
    type: "VALIDATE_AND_SAVE_API_KEY",
    apiKey: value,
  });
  setBusy(false);

  if (!response.ok || !response.state) {
    setMessage(response.ok ? "Could not save this key." : response.error, true);
    return;
  }

  apiKey.value = "";
  render(response.state);
  setMessage("API key validated and saved.", false);
}

async function removeKey(): Promise<void> {
  setBusy(true);
  const response = await sendMessage({ type: "DELETE_API_KEY" });
  setBusy(false);

  if (!response.ok) {
    setMessage(response.error, true);
    return;
  }

  if (response.state) render(response.state);
  setMessage("API key removed. Filtering has stopped in open tabs.", false);
}

async function saveCustomInput(): Promise<void> {
  setBusy(true);
  setCustomMessage("Saving custom input...", false);
  const response = await sendMessage({
    type: "UPDATE_SETTINGS",
    settings: {
      ...currentState.settings,
      customQuestion: customQuestion.value,
      customYesCriteria: customYesCriteria.value,
      customNoCriteria: customNoCriteria.value,
    },
  });
  setBusy(false);

  if (!response.ok || !response.state) {
    setCustomMessage(response.ok ? "Could not save custom input." : response.error, true);
    return;
  }

  render(response.state);
  setCustomMessage("Custom input saved.", false);
}

function render(state: ExtensionState): void {
  currentState = state;
  hasApiKey = state.hasApiKey;
  keyState.textContent = hasApiKey ? "API key configured" : "No API key configured";
  connectionStatus.classList.toggle("connected", hasApiKey);
  stateDot.classList.toggle("connected", hasApiKey);
  deleteKey.hidden = !hasApiKey;
  deleteKey.disabled = !hasApiKey;
  apiKey.classList.toggle("has-key", hasApiKey);
  apiKey.placeholder = hasApiKey
    ? "••••••••••••••••••••••••••••••••"
    : "Enter your TypeSafe API key";
  customQuestion.value = state.settings.customQuestion;
  customYesCriteria.value = state.settings.customYesCriteria;
  customNoCriteria.value = state.settings.customNoCriteria;
}

function setBusy(busy: boolean): void {
  saveKey.disabled = busy;
  deleteKey.disabled = busy || !hasApiKey;
  apiKey.disabled = busy;
  customQuestion.disabled = busy;
  customYesCriteria.disabled = busy;
  customNoCriteria.disabled = busy;
}

function setMessage(value: string, error: boolean): void {
  message.textContent = value;
  message.classList.toggle("error", error);
}

function setCustomMessage(value: string, error: boolean): void {
  customMessage.textContent = value;
  customMessage.classList.toggle("error", error);
}

async function sendMessage(value: ExtensionMessage): Promise<ExtensionResponse> {
  try {
    return (await browser.runtime.sendMessage(value)) as ExtensionResponse;
  } catch {
    return { ok: false, error: "The extension background service is unavailable." };
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}
