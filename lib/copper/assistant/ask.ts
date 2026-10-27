"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, Step } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const APOLOGY = "Sorry, I couldn't answer that just now. Please try again.";

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();

  const steps: Step[] = [];
  let reply = "";

  // A fresh copy every time, so earlier updates never change underneath the
  // panel (or a test) that is holding on to them.
  const snapshot = (status: Progress["status"]): Progress => ({
    steps: steps.map((step) => ({ ...step })),
    reply,
    status,
  });

  const toolStep = (id: string) =>
    steps.find((step) => step.type === "tool" && step.id === id);

  // Read the stream in the background, so the panel gets each update as it
  // happens and not all at the end.
  void (async () => {
    // Send the first update right away, so the panel can show "Reading your
    // question…" before the model has said anything.
    update(snapshot("working"));
    try {
      const messages = request.messages.map(({ role, content }) => ({
        role,
        content,
      }));
      // With tools off, the model gets just the conversation: no
      // instructions and no tools, so it has to answer from memory.
      const result = request.useTools
        ? callStream(
            { module: 2, feature: "ask-copper" },
            {
              instructions: COPPER_INSTRUCTIONS,
              messages,
              tools: copperTools,
              stopWhen: stepCountIs(MAX_STEPS),
              providerOptions: THOUGHT_SUMMARIES,
            },
          )
        : callStream(
            { module: 2, feature: "ask-copper" },
            { messages, providerOptions: THOUGHT_SUMMARIES },
          );

      let failed = false;
      for await (const part of result.fullStream) {
        if (part.type === "reasoning-delta") {
          const last = steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else steps.push({ type: "thinking", text: part.text });
        } else if (part.type === "tool-input-start") {
          steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
        } else if (part.type === "tool-call") {
          let step = toolStep(part.toolCallId);
          if (!step) {
            step = {
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
            };
            steps.push(step);
          }
          if (step.type === "tool") step.input = part.input;
        } else if (part.type === "tool-result") {
          const step = toolStep(part.toolCallId);
          if (step?.type === "tool") {
            step.output = part.output;
            step.state = "done";
          }
        } else if (part.type === "tool-error") {
          const step = toolStep(part.toolCallId);
          if (step?.type === "tool") {
            step.output =
              part.error instanceof Error
                ? part.error.message
                : String(part.error);
            step.state = "error";
          }
        } else if (part.type === "text-delta") {
          reply += part.text;
        } else if (part.type === "error") {
          failed = true;
        } else {
          continue;
        }
        update(snapshot("working"));
      }

      if (failed) {
        if (reply.trim() === "") reply = APOLOGY;
        done(snapshot("error"));
        return;
      }
      // A stream that ends normally with no words is still "done". Only an
      // empty reply gets the apology, never a real one.
      if (reply.trim() === "") reply = APOLOGY;
      done(snapshot("done"));
    } catch {
      if (reply.trim() === "") reply = APOLOGY;
      done(snapshot("error"));
    }
  })();

  return { progress: live };
}
