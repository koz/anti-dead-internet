import { describe, expect, it } from "vitest";
import { isExtensionMessage } from "../lib/messages";

describe("isExtensionMessage", () => {
  it("accepts known message types", () => {
    expect(isExtensionMessage({ type: "GET_EXTENSION_STATE" })).toBe(true);
    expect(isExtensionMessage({ type: "CLASSIFY_TWEET" })).toBe(true);
  });

  it("rejects unknown and malformed messages", () => {
    expect(isExtensionMessage({ type: "FETCH_ARBITRARY_URL" })).toBe(false);
    expect(isExtensionMessage(null)).toBe(false);
    expect(isExtensionMessage("CLASSIFY_TWEET")).toBe(false);
  });
});
