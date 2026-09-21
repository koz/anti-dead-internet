import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/settings";

describe("normalizeSettings", () => {
  it("returns defaults for missing data", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves valid settings", () => {
    expect(
      normalizeSettings({
        enabled: false,
        confidence: "high",
        autoHide: true,
        showScores: true,
        customQuestion: "Is this promotional?",
        customYesCriteria: "It promotes a product.",
        customNoCriteria: "It is not promotional.",
      }),
    ).toEqual({
      enabled: false,
      confidence: "high",
      autoHide: true,
      showScores: true,
      customQuestion: "Is this promotional?",
      customYesCriteria: "It promotes a product.",
      customNoCriteria: "It is not promotional.",
    });
  });

  it("replaces malformed fields individually", () => {
    expect(
      normalizeSettings({
        enabled: "yes",
        confidence: "extreme",
        autoHide: true,
        showScores: "yes",
      }),
    ).toEqual({
      enabled: true,
      confidence: "medium",
      autoHide: true,
      showScores: false,
      customQuestion: DEFAULT_SETTINGS.customQuestion,
      customYesCriteria: DEFAULT_SETTINGS.customYesCriteria,
      customNoCriteria: DEFAULT_SETTINGS.customNoCriteria,
    });
  });
});
