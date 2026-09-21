import { TypeSafeClient } from "@typesafe-ai/sdk";
import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import {
  type ExtensionMessage,
  type ExtensionResponse,
  isExtensionMessage,
} from "../lib/messages";
import {
  API_KEY_STORAGE_KEY,
  CONFIG_REVISION_STORAGE_KEY,
  normalizeSettings,
  SETTINGS_STORAGE_KEY,
} from "../lib/settings";
import {
  classifyTweet,
  createTypeSafeClient,
  validateApiKey,
} from "../lib/typesafe";

const MAX_TWEET_LENGTH = 25_000;
const MAX_CONCURRENT_REQUESTS = 6;
const MAX_CONCURRENT_REQUESTS_PER_TAB = 3;
const controllers = new Map<string, AbortController>();

let cachedApiKey: string | null = null;
let cachedClient: TypeSafeClient | null = null;

interface MessageSender {
  id?: string;
  url?: string;
  tab?: {
    id?: number;
    url?: string;
  };
}

export default defineBackground(() => {
  const storageReady = restrictKeyStorage();

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void handleMessage(message, sender, storageReady)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "The request failed unexpectedly." }));
    return true;
  });
});

async function restrictKeyStorage(): Promise<void> {
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

async function handleMessage(
  value: unknown,
  sender: MessageSender,
  storageReady: Promise<void>,
): Promise<ExtensionResponse> {
  await storageReady;

  if (!isOwnSender(sender) || !isExtensionMessage(value)) {
    return { ok: false, error: "Invalid extension request." };
  }

  const message: ExtensionMessage = value;

  switch (message.type) {
    case "GET_EXTENSION_STATE":
      return getExtensionState();

    case "VALIDATE_AND_SAVE_API_KEY":
      if (!isTrustedUi(sender)) return forbidden();
      return saveApiKey(message.apiKey);

    case "DELETE_API_KEY":
      if (!isTrustedUi(sender)) return forbidden();
      return deleteApiKey();

    case "UPDATE_SETTINGS":
      if (!isTrustedUi(sender)) return forbidden();
      return updateSettings(message.settings);

    case "CLASSIFY_TWEET":
      if (!isTwitterSender(sender)) return forbidden();
      return classify(message, sender);

    case "CANCEL_CLASSIFICATIONS":
      if (!isTwitterSender(sender) || sender.tab?.id === undefined) return forbidden();
      abortRequestsForTab(sender.tab.id);
      return { ok: true };
  }
}

async function getExtensionState(): Promise<ExtensionResponse> {
  const [local, sync] = await Promise.all([
    browser.storage.local.get(API_KEY_STORAGE_KEY),
    browser.storage.sync.get(SETTINGS_STORAGE_KEY),
  ]);

  return {
    ok: true,
    state: {
      hasApiKey: isUsableApiKey(local[API_KEY_STORAGE_KEY]),
      settings: normalizeSettings(sync[SETTINGS_STORAGE_KEY]),
    },
  };
}

async function saveApiKey(value: unknown): Promise<ExtensionResponse> {
  if (typeof value !== "string" || !isUsableApiKey(value.trim()) || value.length > 1_000) {
    return { ok: false, error: "Enter a valid TypeSafe API key." };
  }

  const apiKey = value.trim();
  const client = createTypeSafeClient(apiKey);

  try {
    await validateApiKey(client);
  } catch {
    return {
      ok: false,
      error: "TypeSafe could not validate this API key. Check it and try again.",
    };
  }

  await browser.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey });
  cachedApiKey = apiKey;
  cachedClient = client;
  await bumpConfigRevision();

  return getExtensionState();
}

async function deleteApiKey(): Promise<ExtensionResponse> {
  abortAllRequests();
  cachedApiKey = null;
  cachedClient = null;
  await browser.storage.local.remove(API_KEY_STORAGE_KEY);
  await bumpConfigRevision();
  return getExtensionState();
}

async function updateSettings(value: unknown): Promise<ExtensionResponse> {
  const settings = normalizeSettings(value);
  await browser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: settings });
  if (!settings.enabled) abortAllRequests();
  return getExtensionState();
}

async function classify(
  message: Extract<ExtensionMessage, { type: "CLASSIFY_TWEET" }>,
  sender: MessageSender,
): Promise<ExtensionResponse> {
  if (
    typeof message.requestId !== "string" ||
    message.requestId.length === 0 ||
    message.requestId.length > 100 ||
    typeof message.content !== "string" ||
    message.content.trim().length === 0 ||
    message.content.length > MAX_TWEET_LENGTH ||
    sender.tab?.id === undefined
  ) {
    return { ok: false, error: "Invalid classification request." };
  }

  const client = await getClient();
  if (!client) {
    return {
      ok: false,
      error: "A TypeSafe API key has not been configured.",
      code: "INACTIVE",
    };
  }

  const storedSettings = await browser.storage.sync.get(SETTINGS_STORAGE_KEY);
  const settings = normalizeSettings(storedSettings[SETTINGS_STORAGE_KEY]);
  if (!settings.enabled) {
    return { ok: false, error: "Filtering is paused.", code: "INACTIVE" };
  }

  const key = `${sender.tab.id}:${message.requestId}`;
  if (controllers.has(key)) {
    return {
      ok: false,
      error: "This classification request is already running.",
      code: "BUSY",
    };
  }

  const tabPrefix = `${sender.tab.id}:`;
  const activeForTab = Array.from(controllers.keys()).filter((requestKey) =>
    requestKey.startsWith(tabPrefix),
  ).length;
  if (
    controllers.size >= MAX_CONCURRENT_REQUESTS ||
    activeForTab >= MAX_CONCURRENT_REQUESTS_PER_TAB
  ) {
    return {
      ok: false,
      error: "The classification queue is busy.",
      code: "BUSY",
    };
  }

  const controller = new AbortController();
  controllers.set(key, controller);
  const startedAt = performance.now();

  console.info("[AI Tweet Filter] Analyzing tweet with JEV", {
    requestId: message.requestId,
    tabId: sender.tab.id,
    tweet: message.content,
  });

  try {
    const { score, response } = await classifyTweet(
      client,
      message.content,
      settings,
      controller.signal,
    );
    const durationMs = elapsedMilliseconds(startedAt);

    console.info("[AI Tweet Filter] JEV response", {
      requestId: message.requestId,
      tabId: sender.tab.id,
      durationMs,
      tweet: message.content,
      response,
    });

    return { ok: true, score };
  } catch (error) {
    const durationMs = elapsedMilliseconds(startedAt);
    const details = {
      requestId: message.requestId,
      tabId: sender.tab.id,
      durationMs,
      tweet: message.content,
      error,
    };

    if (controller.signal.aborted) {
      console.info("[AI Tweet Filter] JEV request cancelled", details);
    } else {
      console.warn("[AI Tweet Filter] JEV request failed", details);
    }

    return {
      ok: false,
      error: controller.signal.aborted
        ? "Classification was cancelled."
        : "TypeSafe could not classify this tweet.",
      code: controller.signal.aborted ? "CANCELLED" : undefined,
    };
  } finally {
    if (controllers.get(key) === controller) controllers.delete(key);
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

async function getClient(): Promise<TypeSafeClient | null> {
  const stored = await browser.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY];
  if (!isUsableApiKey(apiKey)) return null;

  if (cachedClient && cachedApiKey === apiKey) return cachedClient;
  cachedApiKey = apiKey;
  cachedClient = createTypeSafeClient(apiKey);
  return cachedClient;
}

async function bumpConfigRevision(): Promise<void> {
  await browser.storage.sync.set({
    [CONFIG_REVISION_STORAGE_KEY]: crypto.randomUUID(),
  });
}

function abortRequestsForTab(tabId: number): void {
  const prefix = `${tabId}:`;
  for (const [key, controller] of controllers) {
    if (key.startsWith(prefix)) controller.abort();
  }
}

function abortAllRequests(): void {
  for (const controller of controllers.values()) controller.abort();
}

function isUsableApiKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOwnSender(sender: MessageSender): boolean {
  return sender.id === browser.runtime.id;
}

function isTrustedUi(sender: MessageSender): boolean {
  return isOwnSender(sender) && sender.tab === undefined;
}

function isTwitterSender(sender: MessageSender): boolean {
  if (!isOwnSender(sender) || sender.tab === undefined) return false;

  try {
    const hostname = new URL(sender.url ?? sender.tab.url ?? "").hostname;
    return (
      hostname === "x.com" ||
      hostname.endsWith(".x.com") ||
      hostname === "twitter.com" ||
      hostname.endsWith(".twitter.com")
    );
  } catch {
    return false;
  }
}

function forbidden(): ExtensionResponse {
  return { ok: false, error: "This operation is not allowed from this context." };
}
