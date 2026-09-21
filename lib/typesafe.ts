import { TypeSafeClient, type NoulQuestion } from "@typesafe-ai/sdk";
import {
  type CustomClassificationSettings,
  DEFAULT_CUSTOM_NO_CRITERIA,
  DEFAULT_CUSTOM_QUESTION,
  DEFAULT_CUSTOM_YES_CRITERIA,
} from "./settings";

export const AI_GENERATED_QUESTION = {
  type: "noul",
  instructions: DEFAULT_CUSTOM_QUESTION,
  criteria: {
    true: DEFAULT_CUSTOM_YES_CRITERIA,
    false: DEFAULT_CUSTOM_NO_CRITERIA,
  },
} as const satisfies NoulQuestion;

export function buildClassificationRequest(
  content: string,
  settings?: Partial<CustomClassificationSettings>,
) {
  const question: NoulQuestion = {
    type: "noul",
    instructions: customValue(settings?.customQuestion, AI_GENERATED_QUESTION.instructions),
    criteria: {
      true: customValue(
        settings?.customYesCriteria,
        AI_GENERATED_QUESTION.criteria.true,
      ),
      false: customValue(
        settings?.customNoCriteria,
        AI_GENERATED_QUESTION.criteria.false,
      ),
    },
  };

  return {
    state: { content },
    questions: {
      aiGenerated: question,
    },
  };
}

export function createTypeSafeClient(apiKey: string): TypeSafeClient {
  return new TypeSafeClient({ apiKey, logLevel: "warn" });
}

export async function validateApiKey(client: TypeSafeClient): Promise<void> {
  await client.models.list();
}

export async function classifyTweet(
  client: TypeSafeClient,
  content: string,
  settings?: Partial<CustomClassificationSettings>,
  signal?: AbortSignal,
) {
  const response = await client.systemOne(buildClassificationRequest(content, settings), {
    signal,
    timeout: 5_000,
    retry: { maxRetries: 10 },
  });
  const score = response.answers.aiGenerated.noul;

  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("TypeSafe returned an invalid noul probability.");
  }

  return { score, response };
}

function customValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}
