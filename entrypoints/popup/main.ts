import { browser } from "wxt/browser";
import type {
  ExtensionMessage,
  ExtensionResponse,
  ExtensionState,
} from "../../lib/messages";
import {
  type ConfidenceLevel,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from "../../lib/settings";
import "./style.css";

const LEVELS: ConfidenceLevel[] = ["low", "medium", "high"];

const setup = element<HTMLElement>("setup");
const controls = element<HTMLElement>("controls");
const keyForm = element<HTMLFormElement>("key-form");
const apiKey = element<HTMLInputElement>("api-key");
const saveKey = element<HTMLButtonElement>("save-key");
const setupError = element<HTMLElement>("setup-error");
const enabled = element<HTMLButtonElement>("enabled");
const enabledLabel = element<HTMLElement>("enabled-label");
const autoHide = element<HTMLInputElement>("auto-hide");
const showScores = element<HTMLInputElement>("show-scores");
const controlsError = element<HTMLElement>("controls-error");
const openSettings = element<HTMLButtonElement>("open-settings");
const confidenceInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="confidence"]'),
);

let currentState: ExtensionState = {
  hasApiKey: false,
  settings: { ...DEFAULT_SETTINGS },
};

keyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitApiKey();
});

enabled.addEventListener("click", () => {
  void saveSettings({
    ...currentState.settings,
    enabled: !currentState.settings.enabled,
  });
});

confidenceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const selected = LEVELS.find((level) => level === input.value) ?? "medium";
    void saveSettings({ ...currentState.settings, confidence: selected });
  });
});

autoHide.addEventListener("change", () => {
  void saveSettings({ ...currentState.settings, autoHide: autoHide.checked });
});

showScores.addEventListener("change", () => {
  void saveSettings({ ...currentState.settings, showScores: showScores.checked });
});

openSettings.addEventListener("click", () => {
  void openOptions();
});

void loadState();

async function loadState(): Promise<void> {
  const response = await sendMessage({ type: "GET_EXTENSION_STATE" });
  if (response.ok && response.state) {
    render(response.state);
    return;
  }

  setup.hidden = false;
  controls.hidden = true;
  showError(response.ok ? "Could not load extension state." : response.error);
}

async function submitApiKey(): Promise<void> {
  const value = apiKey.value.trim();
  if (!value) {
    showError("Enter your TypeSafe API key.");
    return;
  }

  saveKey.disabled = true;
  saveKey.textContent = "Validating...";
  showError("");

  const response = await sendMessage({
    type: "VALIDATE_AND_SAVE_API_KEY",
    apiKey: value,
  });

  saveKey.disabled = false;
  saveKey.textContent = "Validate and continue";

  if (!response.ok || !response.state) {
    showError(response.ok ? "Could not save this API key." : response.error);
    return;
  }

  apiKey.value = "";
  render(response.state);
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  setControlsDisabled(true);
  const response = await sendMessage({ type: "UPDATE_SETTINGS", settings });
  setControlsDisabled(false);

  if (response.ok && response.state) {
    render(response.state);
    return;
  }

  controlsError.textContent = response.ok ? "Could not save settings." : response.error;
}

async function openOptions(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

function render(state: ExtensionState): void {
  currentState = state;
  setup.hidden = state.hasApiKey;
  controls.hidden = !state.hasApiKey;
  controlsError.textContent = "";

  if (!state.hasApiKey) {
    return;
  }

  enabled.classList.toggle("is-paused", !state.settings.enabled);
  enabledLabel.textContent = "";
  enabled.setAttribute("aria-label", state.settings.enabled ? "Pause filtering" : "Start filtering");

  confidenceInputs.forEach((input) => {
    input.checked = input.value === state.settings.confidence;
  });
  autoHide.checked = state.settings.autoHide;
  showScores.checked = state.settings.showScores;
}

function setControlsDisabled(disabled: boolean): void {
  enabled.disabled = disabled;
  confidenceInputs.forEach((input) => {
    input.disabled = disabled;
  });
  autoHide.disabled = disabled;
  showScores.disabled = disabled;
}

function showError(message: string): void {
  setupError.textContent = message;
}

async function sendMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  try {
    return (await browser.runtime.sendMessage(message)) as ExtensionResponse;
  } catch {
    return { ok: false, error: "The extension background service is unavailable." };
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}
