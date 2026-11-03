// When the model call fails, the shopper sees the apology and the real reason
// goes to the server log (so it shows up in Vercel's logs).
import type { Live } from "@/lib/ai/live";
import { finalValue } from "@/lib/ai/live";
import type { Progress } from "@/lib/copper/assistant/progress";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

const question = [{ role: "user" as const, content: "Is Copper Plus cheaper yearly?" }];

async function failingAsk(useTools: boolean) {
  vi.resetModules();
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  const { askCopper } = await import("@/lib/copper/assistant/ask");
  const result: { progress: Live<Progress> } = await askCopper({
    messages: question,
    useTools,
  });
  return finalValue(result.progress);
}

describe("askCopper failures", () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("models/gemini-2.5-flash is no longer available");
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    "logs the real reason and shows the apology (tools: %s)",
    async (useTools) => {
      const result = await failingAsk(useTools);
      expect(result.status).toBe("error");
      expect(result.reply).toBe(
        "Sorry, I couldn't answer that just now. Please try again.",
      );
      expect(errors.join("\n")).toContain("[ask-copper]");
      expect(errors.join("\n")).toContain("no longer available");
    },
  );

  it("never logs the API key", async () => {
    await failingAsk(true);
    expect(errors.join("\n")).not.toContain("AIza-test-key");
  });
});
