"use client";

// Module 2: the floating Ask Copper chat. A launcher opens a side panel where
// a shopper can ask about products, prices, totals and stock, and watch Copper
// think, pick a tool, and answer. Tools on and tools off are two separate
// conversations, so the tools-off model can't copy what the tools worked out.
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  MessageCircleIcon,
  Wand2Icon,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { SetupRequired } from "@/components/setup-required";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper } from "@/lib/copper/assistant/ask";
import { toolCallsOf } from "@/lib/copper/assistant/progress";
import type { Progress, ToolStep } from "@/lib/copper/assistant/progress";
import { cn } from "@/lib/utils";
import {
  Station,
  ThinkingStation,
  ToolsStation,
  ToolStation,
  WorkingStation,
} from "./ask-copper-steps";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

type Turn =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; progress: Progress };

type Chats = { on: Turn[]; off: Turn[] };

let nextId = 0;
const newId = () => `turn-${++nextId}`;

/** One answer: the stations on a rail, then Copper's reply. */
function Answer({ progress, tools }: { progress: Progress; tools: boolean }) {
  const used = new Set(toolCallsOf(progress).map((call) => call.name));
  const working = progress.status === "working";
  let toolNumber = 0;
  return (
    <div className="relative">
      <span
        className={cn(
          "absolute top-3 bottom-3 left-3 w-0.5 -translate-x-1/2 bg-gradient-to-b",
          tools
            ? "from-primary via-accent to-accent"
            : "from-chart-3 to-chart-3",
        )}
      />
      <ToolsStation tools={tools} used={used} />
      {progress.steps.map((step, index) =>
        step.type === "thinking" ? (
          <ThinkingStation key={index} text={step.text} tools={tools} />
        ) : (
          <ToolStation
            key={step.id}
            step={step as ToolStep}
            number={++toolNumber}
          />
        ),
      )}
      {working && <WorkingStation progress={progress} tools={tools} />}
      {(progress.reply || !working) && (
        <div className="bg-card ml-9 rounded-xl rounded-tl-none border p-3 text-sm shadow-sm">
          <p className="text-primary mb-1 text-xs font-bold">Copper</p>
          {!tools && (
            <div className="border-chart-3 bg-chart-3/10 mb-2 flex gap-2 rounded-md border p-2 text-xs">
              <AlertTriangleIcon className="text-chart-3 mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">
                  Answered without tools: may be made up
                </p>
                <p className="text-muted-foreground">
                  With tools off, Copper can&apos;t see today&apos;s prices or
                  stock. The AI only has what it learned in training, so it
                  fills the gaps with guesses that sound right. That&apos;s a
                  hallucination.
                </p>
              </div>
            </div>
          )}
          <p className="whitespace-pre-wrap">
            {progress.reply}
            {working && (
              <span className="bg-foreground ml-0.5 inline-block h-4 w-0.5 animate-pulse align-middle" />
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Chats>({ on: [], off: [] });
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Open from /#ask, and from any "Ask Copper" link. Once the address already
  // ends in #ask, clicking the link again fires no hashchange, so listen for
  // the click as well.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    onHash();
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (link?.getAttribute("href")?.endsWith("#ask")) setOpen(true);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const mode = useTools ? "on" : "off";
  const turns = chats[mode];
  const last = turns.at(-1);
  const busy = last?.role === "assistant" && last.progress.status === "working";

  // Keep the newest step in view as the answer streams in.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chats, mode, open]);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      const key = mode;
      // Only this chat's own questions and finished replies are sent.
      const history = chats[key].map((turn) => ({
        role: turn.role,
        content: turn.role === "user" ? turn.content : turn.progress.reply,
      }));
      const messages = [...history, { role: "user" as const, content: text }];
      const answerId = newId();
      setDraft("");
      setChats((current) => ({
        ...current,
        [key]: [
          ...current[key],
          { id: newId(), role: "user", content: text },
          {
            id: answerId,
            role: "assistant",
            progress: { steps: [], reply: "", status: "working" },
          },
        ],
      }));
      const show = (progress: Progress) =>
        setChats((current) => ({
          ...current,
          [key]: current[key].map((turn) =>
            turn.id === answerId && turn.role === "assistant"
              ? { ...turn, progress }
              : turn,
          ),
        }));
      try {
        const { progress } = await askCopper({
          messages,
          useTools: key === "on",
        });
        for await (const update of readLive(progress)) show(update);
      } catch {
        show({
          steps: [],
          reply: "Sorry, I couldn't answer that just now. Please try again.",
          status: "error",
        });
      }
    },
    [busy, chats, mode],
  );

  return (
    <>
      <button
        type="button"
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="bg-primary text-primary-foreground fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg"
      >
        <MessageCircleIcon className="size-4" />
        Ask Copper
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="ask-copper"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-md gap-0 p-0"
        >
          <div className="bg-chart-5 text-white">
            <div className="flex items-center gap-3 p-4 pr-12">
              <span className="bg-primary flex size-10 items-center justify-center overflow-hidden rounded-full">
                <Image
                  src="/assets/brand/copper-mascot.png"
                  alt="Copper robot mascot"
                  width={40}
                  height={40}
                  className="size-8 object-contain"
                />
              </span>
              <div>
                <SheetTitle className="text-white">Ask Copper</SheetTitle>
                <SheetDescription className="text-white/70">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center justify-between bg-white/10 px-4 py-2 text-sm">
              <label htmlFor="use-tools" className="font-medium">
                Use tools
              </label>
              <span className="flex items-center gap-2">
                <span className="text-xs text-white/70">
                  {useTools ? "Checks every answer" : "Model guesses alone"}
                </span>
                <Switch
                  id="use-tools"
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                />
              </span>
            </div>
          </div>

          {!aiConfigured ? (
            <div className="bg-secondary flex-1 overflow-y-auto p-4">
              <SetupRequired service="ai" />
            </div>
          ) : (
            <>
              <div
                ref={bodyRef}
                className="bg-secondary flex-1 overflow-y-auto p-4"
              >
                <div className="flex flex-col gap-4">
                  {turns.length === 0 && (
                    <Station
                      icon={<Wand2Icon className="size-3.5" />}
                      nodeClassName="bg-primary"
                    >
                      <p className="pt-0.5 text-sm">
                        Hi, I&apos;m Copper. Ask me about our products, prices
                        and stock.
                      </p>
                    </Station>
                  )}
                  {turns.map((turn) =>
                    turn.role === "user" ? (
                      <div
                        key={turn.id}
                        className="bg-primary text-primary-foreground ml-auto max-w-[85%] rounded-xl rounded-tr-none px-3 py-2 text-sm"
                      >
                        {turn.content}
                      </div>
                    ) : (
                      <Answer
                        key={turn.id}
                        progress={turn.progress}
                        tools={useTools}
                      />
                    ),
                  )}
                  {!busy && (
                    <div className="flex flex-col items-start gap-2">
                      {STARTERS.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          onClick={() => void ask(starter)}
                          className="bg-background hover:bg-muted rounded-full border px-3 py-1.5 text-left text-sm"
                        >
                          {starter}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <form
                className="bg-background flex items-center gap-2 border-t p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(draft);
                }}
              >
                <input
                  type="text"
                  aria-label="Your question"
                  placeholder="Ask about prices or stock…"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="bg-background flex-1 rounded-full border px-4 py-2 text-sm outline-none"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={busy || draft.trim() === ""}
                  className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full disabled:opacity-50"
                >
                  <ArrowUpIcon className="size-4" />
                </button>
              </form>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
