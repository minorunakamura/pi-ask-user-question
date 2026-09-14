import type {
  AnswerDetail,
  AnswerValue,
  AskUserQuestionDetails,
  NormalizedQuestion,
  QuestionItem,
  QuestionnaireStatus,
} from "./core/ask-user-question";

export type {
  AnswerDetail,
  AnswerValue,
  AskOption,
  AskUserQuestionDetails,
  NormalizedQuestion,
  QuestionItem,
  QuestionnaireStatus,
} from "./core/ask-user-question";

export type Question = QuestionItem;

export const ASK_USER_QUESTION_REQUEST_EVENT =
  "pi-ask-user-question:request:v1";
export const ASK_USER_QUESTION_CANCEL_EVENT = "pi-ask-user-question:cancel:v1";
export const ASK_USER_QUESTION_REPLY_EVENT_PREFIX =
  "pi-ask-user-question:reply:";

export function getAskUserQuestionReplyEvent(requestId: string): string {
  return `${ASK_USER_QUESTION_REPLY_EVENT_PREFIX}${requestId}`;
}

export interface AskUserQuestionRequest {
  version: 1;
  requestId: string;
  title?: string;
  questions: QuestionItem[];
}

export interface AskUserQuestionCancelRequest {
  version: 1;
  requestId: string;
}

export interface AskUserQuestionResult {
  status: QuestionnaireStatus;
  questions: NormalizedQuestion[];
  answers: Record<string, AnswerValue>;
  selections: AnswerDetail[];
  cancelled: boolean;
  response?: string;
}

export type AskUserQuestionErrorCode =
  | "invalid-request"
  | "unsupported-version"
  | "duplicate-request-id"
  | "tui-unavailable"
  | "internal-error";

export interface AskUserQuestionErrorResponse {
  version: 1;
  requestId: string;
  success: false;
  error: {
    code: AskUserQuestionErrorCode;
    message: string;
  };
}

export interface AskUserQuestionSuccessResponse {
  version: 1;
  requestId: string;
  success: true;
  result: AskUserQuestionResult;
}

export type AskUserQuestionResponse =
  | AskUserQuestionSuccessResponse
  | AskUserQuestionErrorResponse;

export function resultFromDetails(
  status: QuestionnaireStatus,
  details: AskUserQuestionDetails,
): AskUserQuestionResult {
  return { status, ...details };
}
