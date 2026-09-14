import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import extension from "../../src/index";
import {
  ASK_USER_QUESTION_CANCEL_EVENT,
  ASK_USER_QUESTION_REQUEST_EVENT,
  getAskUserQuestionReplyEvent,
  type AskUserQuestionResponse,
} from "../../src/api";
import {
  buildDetails,
  normalizeQuestions,
  type AskUserQuestionDetails,
} from "../../src/core/ask-user-question";

interface FakePi {
  on(
    event: string,
    handler: (event: unknown, ctx: ExtensionContext) => unknown,
  ): void;
  registerTool(definition: any): void;
  events: {
    on(channel: string, handler: (data: unknown) => void): () => void;
    emit(channel: string, data: unknown): void;
    listenerCount(channel: string): number;
  };
  trigger(event: string, ctx: ExtensionContext): Promise<void>;
  tools: Array<any>;
}

function createFakePi(): FakePi {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const lifecycle = new Map<
    string,
    Array<(event: unknown, ctx: ExtensionContext) => unknown>
  >();
  const tools: Array<any> = [];

  const events = {
    on(channel: string, handler: (data: unknown) => void) {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(handler);
      listeners.set(channel, channelListeners);
      return () => channelListeners.delete(handler);
    },
    emit(channel: string, data: unknown) {
      for (const handler of listeners.get(channel) ?? []) handler(data);
    },
    listenerCount(channel: string) {
      return listeners.get(channel)?.size ?? 0;
    },
  };

  return {
    on(
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) {
      const handlers = lifecycle.get(event) ?? [];
      handlers.push(handler);
      lifecycle.set(event, handlers);
    },
    events,
    tools,
    registerTool(definition: any) {
      tools.push(definition);
    },
    async trigger(event, ctx) {
      for (const handler of lifecycle.get(event) ?? []) {
        await handler({ type: event }, ctx);
      }
    },
  };
}

function createContext(mode: "tui" | "print" = "tui") {
  const doneCallbacks: Array<(result: AskUserQuestionDetails) => void> = [];
  const components: Array<{ dispose?: () => void }> = [];
  const custom = vi.fn(
    async (
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: AskUserQuestionDetails) => void,
      ) => { dispose?: () => void },
    ) =>
      new Promise<AskUserQuestionDetails>((resolve) => {
        const done = (result: AskUserQuestionDetails) => {
          resolve(result);
        };
        const component = factory(
          { requestRender: vi.fn() },
          {
            fg: (_color: string, text: string) => text,
            bg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          done,
        );
        doneCallbacks.push(done);
        components.push(component);
      }),
  );

  const ctx = {
    mode,
    ui: { custom },
  } as unknown as ExtensionContext;
  return { ctx, custom, doneCallbacks, components };
}

function validQuestions() {
  return [
    {
      question: "Format?",
      header: "Format",
      options: [{ label: "JSON" }, { label: "Text" }],
    },
  ];
}

function answerFor(questions: ReturnType<typeof normalizeQuestions>) {
  return buildDetails(
    questions,
    new Map([[0, { selectedIndices: [0] }]]),
    false,
  );
}

function nextReply(
  pi: FakePi,
  requestId: string,
): Promise<AskUserQuestionResponse> {
  return new Promise((resolve) => {
    pi.events.on(getAskUserQuestionReplyEvent(requestId), (data) => {
      resolve(data as AskUserQuestionResponse);
    });
  });
}

async function start(pi: FakePi, context: ReturnType<typeof createContext>) {
  await pi.trigger("session_start", context.ctx);
}

function nextTick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe("ask_user_question extension event API", () => {
  it("keeps the existing tool and routes it through the shared UI runtime", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    expect(pi.tools).toHaveLength(1);
    expect(pi.tools[0].name).toBe("ask_user_question");

    const resultPromise = pi.tools[0].execute(
      "tool-1",
      { questions: validQuestions() },
      undefined,
      undefined,
      context.ctx,
    );
    await Promise.resolve();
    context.doneCallbacks[0]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );

    await expect(resultPromise).resolves.toMatchObject({
      details: { answers: { "Format?": "JSON" }, cancelled: false },
    });
  });

  it("receives a request, executes the questionnaire, and replies with requestId", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    const requestId = "request-1";
    const reply = nextReply(pi, requestId);
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId,
      title: "Choose a format",
      questions: validQuestions(),
    });
    await Promise.resolve();
    expect(context.custom).toHaveBeenCalledTimes(1);
    context.doneCallbacks[0]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );

    await expect(reply).resolves.toMatchObject({
      version: 1,
      requestId,
      success: true,
      result: {
        status: "answered",
        answers: { "Format?": "JSON" },
        cancelled: false,
      },
    });
  });

  it("serializes a programmatic request behind an active Tool questionnaire", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    const toolResult = pi.tools[0].execute(
      "tool-queue",
      { questions: validQuestions() },
      undefined,
      undefined,
      context.ctx,
    );
    await Promise.resolve();

    const reply = nextReply(pi, "after-tool");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "after-tool",
      questions: validQuestions(),
    });
    await Promise.resolve();
    expect(context.custom).toHaveBeenCalledTimes(1);

    context.doneCallbacks[0]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );
    await toolResult;
    await nextTick();
    expect(context.custom).toHaveBeenCalledTimes(2);
    context.doneCallbacks[1]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );
    await expect(reply).resolves.toMatchObject({
      requestId: "after-tool",
      success: true,
      result: { status: "answered" },
    });
  });

  it("does not lose a request emitted before session_start", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    const reply = nextReply(pi, "startup-1");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "startup-1",
      questions: validQuestions(),
    });

    await start(pi, context);
    await Promise.resolve();
    expect(context.custom).toHaveBeenCalledTimes(1);
    context.doneCallbacks[0]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );
    await expect(reply).resolves.toMatchObject({
      requestId: "startup-1",
      success: true,
    });
  });

  it("uses the same validation for tool and programmatic requests", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    const invalidQuestions = [{ question: "", options: [] }];
    const toolResult = await pi.tools[0].execute(
      "tool-invalid",
      { questions: invalidQuestions },
      undefined,
      undefined,
      context.ctx,
    );
    const reply = nextReply(pi, "invalid-1");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "invalid-1",
      questions: invalidQuestions,
    });

    expect(toolResult.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("must not be blank"),
    });
    await expect(reply).resolves.toMatchObject({
      success: false,
      error: { code: "invalid-request" },
    });
    expect(context.custom).not.toHaveBeenCalled();
  });

  it("returns structured user cancellation and never opens UI in non-TUI mode", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const tuiContext = createContext();
    await start(pi, tuiContext);

    const cancelledReply = nextReply(pi, "cancelled-1");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "cancelled-1",
      questions: validQuestions(),
    });
    await Promise.resolve();
    tuiContext.doneCallbacks[0]?.(
      buildDetails(
        normalizeQuestions({ questions: validQuestions() }),
        new Map(),
        true,
      ),
    );
    await expect(cancelledReply).resolves.toMatchObject({
      success: true,
      result: { status: "user-cancelled", cancelled: true },
    });

    const printPi = createFakePi();
    extension(printPi as unknown as ExtensionAPI);
    const printContext = createContext("print");
    await start(printPi, printContext);
    const unavailable = nextReply(printPi, "print-1");
    printPi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "print-1",
      questions: validQuestions(),
    });
    await expect(unavailable).resolves.toMatchObject({
      success: false,
      error: { code: "tui-unavailable" },
    });
    expect(printContext.custom).not.toHaveBeenCalled();
  });

  it("rejects invalid requests and unsupported versions without opening UI", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    const invalid = nextReply(pi, "invalid-2");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "invalid-2",
      questions: [{ question: "x", options: [{ label: "" }] }],
    });
    const unsupported = nextReply(pi, "version-2");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 2,
      requestId: "version-2",
      questions: validQuestions(),
    });

    await expect(invalid).resolves.toMatchObject({
      success: false,
      error: { code: "invalid-request" },
    });
    await expect(unsupported).resolves.toMatchObject({
      success: false,
      error: { code: "unsupported-version" },
    });
    expect(context.custom).not.toHaveBeenCalled();
  });

  it("returns a machine-readable internal error when UI execution fails", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    context.custom.mockRejectedValueOnce(new Error("UI failed"));
    await start(pi, context);

    const reply = nextReply(pi, "internal-1");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "internal-1",
      questions: validQuestions(),
    });

    await expect(reply).resolves.toMatchObject({
      success: false,
      error: { code: "internal-error", message: "UI failed" },
    });
  });

  it("rejects duplicate ids and serializes concurrent questionnaires", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    const first = nextReply(pi, "same-id");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "same-id",
      questions: validQuestions(),
    });
    await Promise.resolve();

    const duplicate = nextReply(pi, "same-id");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "same-id",
      questions: validQuestions(),
    });
    await expect(duplicate).resolves.toMatchObject({
      success: false,
      error: { code: "duplicate-request-id" },
    });

    const second = nextReply(pi, "second-id");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "second-id",
      questions: validQuestions(),
    });
    await Promise.resolve();
    expect(context.custom).toHaveBeenCalledTimes(1);

    context.doneCallbacks[0]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );
    await first;
    await nextTick();
    expect(context.custom).toHaveBeenCalledTimes(2);
    context.doneCallbacks[1]?.(
      answerFor(normalizeQuestions({ questions: validQuestions() })),
    );
    await expect(second).resolves.toMatchObject({
      requestId: "second-id",
      success: true,
      result: { status: "answered" },
    });
  });

  it("maps caller cancellation and shutdown to terminal results", async () => {
    const pi = createFakePi();
    extension(pi as unknown as ExtensionAPI);
    const context = createContext();
    await start(pi, context);

    const aborted = nextReply(pi, "abort-1");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "abort-1",
      questions: validQuestions(),
    });
    await Promise.resolve();
    pi.events.emit(ASK_USER_QUESTION_CANCEL_EVENT, {
      version: 1,
      requestId: "abort-1",
    });
    await expect(aborted).resolves.toMatchObject({
      success: true,
      result: { status: "caller-aborted", cancelled: true },
    });

    const active = nextReply(pi, "shutdown-active");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "shutdown-active",
      questions: validQuestions(),
    });
    const queued = nextReply(pi, "shutdown-queued");
    pi.events.emit(ASK_USER_QUESTION_REQUEST_EVENT, {
      version: 1,
      requestId: "shutdown-queued",
      questions: validQuestions(),
    });
    await Promise.resolve();
    await pi.trigger("session_shutdown", context.ctx);

    await expect(active).resolves.toMatchObject({
      success: true,
      result: { status: "shutdown", cancelled: true },
    });
    await expect(queued).resolves.toMatchObject({
      success: true,
      result: { status: "shutdown", cancelled: true },
    });
    expect(pi.events.listenerCount(ASK_USER_QUESTION_REQUEST_EVENT)).toBe(0);
    expect(pi.events.listenerCount(ASK_USER_QUESTION_CANCEL_EVENT)).toBe(0);
  });
});
