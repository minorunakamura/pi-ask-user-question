import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  cancelledDetails,
  type NormalizedQuestion,
  type QuestionnaireExecutionResult,
  type QuestionnaireFailure,
  type QuestionnaireSuccess,
  validateAndNormalizeQuestions,
} from "../core/ask-user-question";
import {
  ASK_USER_QUESTION_CANCEL_EVENT,
  ASK_USER_QUESTION_REQUEST_EVENT,
  type AskUserQuestionErrorCode,
  type AskUserQuestionResponse,
  type AskUserQuestionResult,
  getAskUserQuestionReplyEvent,
  resultFromDetails,
} from "../api";
import {
  type QuestionnaireJobHandle,
  QuestionnaireService,
} from "./questionnaire-service";

interface ParsedRequest {
  requestId?: string;
  fingerprint?: string;
  request?: {
    requestId: string;
    title?: string;
    questions: NormalizedQuestion[];
  };
  error?: {
    code: AskUserQuestionErrorCode;
    message: string;
  };
}

interface PendingRequest {
  requestId: string;
  fingerprint: string;
  questions: NormalizedQuestion[];
  title?: string;
  handle?: QuestionnaireJobHandle;
  settled: boolean;
}

interface CompletedRequest {
  fingerprint?: string;
  response: AskUserQuestionResponse;
}

const COMPLETED_REQUEST_CACHE_LIMIT = 64;

function internalFailure(
  questions: NormalizedQuestion[],
  error: unknown,
): QuestionnaireFailure {
  return {
    status: "failed",
    error: {
      code: "internal-error",
      message: error instanceof Error ? error.message : String(error),
    },
    details: cancelledDetails(questions),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function validRequestId(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}

function requestFingerprint(
  request: Omit<NonNullable<ParsedRequest["request"]>, "requestId">,
): string {
  return JSON.stringify({
    version: 1,
    title: request.title ?? "",
    questions: request.questions,
  });
}

function rawRequestFingerprint(
  record: Record<string, unknown>,
): string | undefined {
  try {
    return JSON.stringify({
      version: record.version,
      title: record.title,
      questions: record.questions,
    });
  } catch {
    return undefined;
  }
}

function parseRequest(data: unknown): ParsedRequest {
  const record = asRecord(data);
  const requestId = record?.requestId;
  const parsedRequestId = validRequestId(requestId) ? requestId : undefined;
  const fingerprint = record ? rawRequestFingerprint(record) : undefined;

  if (!record) {
    return {
      error: { code: "invalid-request", message: "Request must be an object" },
    };
  }
  if (!("version" in record)) {
    return {
      requestId: parsedRequestId,
      fingerprint,
      error: { code: "invalid-request", message: "version is required" },
    };
  }
  if (record.version !== 1) {
    return {
      requestId: parsedRequestId,
      fingerprint,
      error: {
        code: "unsupported-version",
        message: "Unsupported ask_user_question request version",
      },
    };
  }
  if (!parsedRequestId) {
    return {
      error: {
        code: "invalid-request",
        message:
          "requestId must be a non-blank string of at most 256 characters",
      },
    };
  }
  if (record.title !== undefined && typeof record.title !== "string") {
    return {
      requestId: parsedRequestId,
      fingerprint,
      error: { code: "invalid-request", message: "title must be a string" },
    };
  }

  const validation = validateAndNormalizeQuestions({
    questions: record.questions,
  });
  if (!validation.ok) {
    return {
      requestId: parsedRequestId,
      fingerprint,
      error: { code: "invalid-request", message: validation.error.message },
    };
  }

  const request: ParsedRequest["request"] = {
    requestId: parsedRequestId,
    questions: validation.questions,
  };
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (title) request.title = title;
  return {
    requestId: parsedRequestId,
    fingerprint: requestFingerprint(request),
    request,
  };
}

function resultFromExecution(
  execution: QuestionnaireSuccess,
): AskUserQuestionResult {
  return resultFromDetails(execution.status, execution.details);
}

function errorResponse(
  requestId: string,
  code: AskUserQuestionErrorCode,
  message: string,
): AskUserQuestionResponse {
  return {
    version: 1,
    requestId,
    success: false,
    error: { code, message },
  };
}

function responseFromExecution(
  requestId: string,
  execution: QuestionnaireExecutionResult,
): AskUserQuestionResponse {
  if (execution.status === "failed") {
    return errorResponse(
      requestId,
      execution.error.code,
      execution.error.message,
    );
  }
  return {
    version: 1,
    requestId,
    success: true,
    result: resultFromExecution(execution),
  };
}

function shutdownExecution(
  questions: NormalizedQuestion[],
): QuestionnaireSuccess {
  return { status: "shutdown", details: cancelledDetails(questions) };
}

export function registerAskUserQuestionEvents(
  pi: ExtensionAPI,
  service: QuestionnaireService,
) {
  let currentContext: ExtensionContext | undefined;
  let sessionStarted = false;
  let shuttingDown = false;
  const waiting: PendingRequest[] = [];
  const pending = new Map<string, PendingRequest>();
  const completed = new Map<string, CompletedRequest>();

  function rememberCompleted(
    requestId: string,
    fingerprint: string | undefined,
    response: AskUserQuestionResponse,
  ) {
    completed.delete(requestId);
    completed.set(requestId, { fingerprint, response });
    while (completed.size > COMPLETED_REQUEST_CACHE_LIMIT) {
      const oldestRequestId = completed.keys().next().value;
      if (oldestRequestId === undefined) break;
      completed.delete(oldestRequestId);
    }
  }

  let unsubscribeRequest: (() => void) | undefined = pi.events.on(
    ASK_USER_QUESTION_REQUEST_EVENT,
    (data) => {
      const parsed = parseRequest(data);
      if (!parsed.requestId) return;

      const pendingRequest = pending.get(parsed.requestId);
      if (pendingRequest) {
        if (parsed.fingerprint === pendingRequest.fingerprint) return;
        return;
      }

      const completedRequest = completed.get(parsed.requestId);
      if (completedRequest) {
        if (parsed.fingerprint === completedRequest.fingerprint) {
          pi.events.emit(
            getAskUserQuestionReplyEvent(parsed.requestId),
            completedRequest.response,
          );
        }
        return;
      }

      if (parsed.error) {
        const response = errorResponse(
          parsed.requestId,
          parsed.error.code,
          parsed.error.message,
        );
        rememberCompleted(parsed.requestId, parsed.fingerprint, response);
        pi.events.emit(
          getAskUserQuestionReplyEvent(parsed.requestId),
          response,
        );
        return;
      }
      if (!parsed.request) return;

      const request: PendingRequest = {
        requestId: parsed.request.requestId,
        fingerprint: parsed.fingerprint ?? requestFingerprint(parsed.request),
        questions: parsed.request.questions,
        title: parsed.request.title,
        settled: false,
      };
      pending.set(request.requestId, request);
      if (shuttingDown) {
        complete(request, shutdownExecution(request.questions));
      } else if (currentContext && sessionStarted) {
        start(request);
      } else {
        waiting.push(request);
      }
    },
  );

  const unsubscribeCancel = pi.events.on(
    ASK_USER_QUESTION_CANCEL_EVENT,
    (data) => {
      const record = asRecord(data);
      if (record?.version !== 1 || !validRequestId(record.requestId)) return;
      const request = pending.get(record.requestId);
      if (!request || request.settled) return;

      if (!request.handle) {
        const index = waiting.indexOf(request);
        if (index >= 0) waiting.splice(index, 1);
        complete(request, {
          status: "caller-aborted",
          details: cancelledDetails(request.questions),
        });
        return;
      }
      request.handle.cancel();
    },
  );

  function start(request: PendingRequest) {
    if (request.settled || !currentContext || !sessionStarted) return;

    try {
      request.handle = service.enqueue({
        questions: request.questions,
        title: request.title,
        ctx: currentContext,
      });
    } catch (error) {
      complete(request, internalFailure(request.questions, error));
      return;
    }

    void request.handle.promise
      .then((execution) => complete(request, execution))
      .catch((error) =>
        complete(request, internalFailure(request.questions, error)),
      );
  }

  function complete(
    request: PendingRequest,
    execution: QuestionnaireExecutionResult,
  ) {
    if (request.settled) return;
    request.settled = true;
    pending.delete(request.requestId);
    const response = responseFromExecution(request.requestId, execution);
    rememberCompleted(request.requestId, request.fingerprint, response);
    pi.events.emit(getAskUserQuestionReplyEvent(request.requestId), response);
  }

  function drainWaiting() {
    if (!currentContext || !sessionStarted) return;
    while (waiting.length > 0) {
      const request = waiting.shift();
      if (request) start(request);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    sessionStarted = true;
    shuttingDown = false;
    drainWaiting();
  });

  pi.on("session_shutdown", () => {
    shuttingDown = true;
    sessionStarted = false;
    currentContext = undefined;
    service.shutdown();

    for (const request of waiting.splice(0)) {
      complete(request, shutdownExecution(request.questions));
    }
    for (const request of pending.values()) {
      complete(request, shutdownExecution(request.questions));
    }
    pending.clear();
    completed.clear();
    unsubscribeRequest?.();
    unsubscribeCancel?.();
    unsubscribeRequest = undefined;
  });

  return {
    dispose() {
      shuttingDown = true;
      sessionStarted = false;
      currentContext = undefined;
      service.shutdown();
      for (const request of waiting.splice(0)) {
        complete(request, shutdownExecution(request.questions));
      }
      for (const request of pending.values()) {
        complete(request, shutdownExecution(request.questions));
      }
      pending.clear();
      completed.clear();
      unsubscribeRequest?.();
      unsubscribeCancel?.();
      unsubscribeRequest = undefined;
    },
  };
}
