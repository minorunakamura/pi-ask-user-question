import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  cancelledDetails,
  type NormalizedQuestion,
  type QuestionnaireExecutionResult,
  type QuestionnaireFailure,
  type QuestionnaireStatus,
} from "../core/ask-user-question";
import { executeQuestionnaire } from "./run-questionnaire";

export interface QuestionnaireJobOptions {
  questions: NormalizedQuestion[];
  signal?: AbortSignal;
  ctx: ExtensionContext;
  title?: string;
}

export interface QuestionnaireJobHandle {
  promise: Promise<QuestionnaireExecutionResult>;
  cancel(): void;
}

interface QuestionnaireJob {
  options: QuestionnaireJobOptions;
  controller: AbortController;
  resolve: (result: QuestionnaireExecutionResult) => void;
  settled: boolean;
  started: boolean;
  removeAbortListener?: () => void;
}

function cancelledResult(
  questions: NormalizedQuestion[],
  status: Exclude<QuestionnaireStatus, "answered">,
): QuestionnaireExecutionResult {
  return { status, details: cancelledDetails(questions) };
}

export class QuestionnaireService {
  private readonly queue: QuestionnaireJob[] = [];
  private active?: QuestionnaireJob;
  private closed = false;

  enqueue(options: QuestionnaireJobOptions): QuestionnaireJobHandle {
    if (this.closed) {
      return this.completedHandle(
        cancelledResult(options.questions, "shutdown"),
      );
    }

    if (options.signal?.aborted) {
      return this.completedHandle(
        cancelledResult(options.questions, "caller-aborted"),
      );
    }

    let resolve!: (result: QuestionnaireExecutionResult) => void;
    const promise = new Promise<QuestionnaireExecutionResult>((done) => {
      resolve = done;
    });
    const job: QuestionnaireJob = {
      options,
      controller: new AbortController(),
      resolve,
      settled: false,
      started: false,
    };

    const onAbort = () => this.cancelJob(job, "caller-aborted");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    job.removeAbortListener = () =>
      options.signal?.removeEventListener("abort", onAbort);

    this.queue.push(job);
    this.startNext();

    return {
      promise,
      cancel: () => this.cancelJob(job, "caller-aborted"),
    };
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;

    for (const job of this.queue.splice(0)) {
      this.cancelJob(job, "shutdown");
    }
    if (this.active) {
      this.cancelJob(this.active, "shutdown");
    }
  }

  get pendingCount(): number {
    return (
      this.queue.filter((job) => !job.settled).length +
      (this.active && !this.active.settled ? 1 : 0)
    );
  }

  private completedHandle(
    result: QuestionnaireExecutionResult,
  ): QuestionnaireJobHandle {
    return { promise: Promise.resolve(result), cancel: () => {} };
  }

  private startNext() {
    if (this.closed || this.active) return;

    const job = this.queue.shift();
    if (!job) return;
    if (job.settled) {
      this.startNext();
      return;
    }

    this.active = job;
    job.started = true;
    void this.runJob(job).finally(() => {
      job.removeAbortListener?.();
      if (this.active === job) this.active = undefined;
      this.startNext();
    });
  }

  private async runJob(job: QuestionnaireJob) {
    let result: QuestionnaireExecutionResult;
    try {
      result = await executeQuestionnaire(
        job.options.questions,
        job.controller.signal,
        job.options.ctx,
        job.options.title,
      );
    } catch (error) {
      result = {
        status: "failed",
        error: {
          code: "internal-error",
          message: error instanceof Error ? error.message : String(error),
        },
        details: cancelledDetails(job.options.questions),
      } satisfies QuestionnaireFailure;
    }
    this.settleJob(job, result);
  }

  private cancelJob(
    job: QuestionnaireJob,
    status: Exclude<QuestionnaireStatus, "answered">,
  ) {
    if (job.settled) return;

    job.controller.abort(status === "shutdown" ? "shutdown" : "caller-aborted");
    if (!job.started) {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
    }
    this.settleJob(job, cancelledResult(job.options.questions, status));
    if (!job.started) this.startNext();
  }

  private settleJob(
    job: QuestionnaireJob,
    result: QuestionnaireExecutionResult,
  ) {
    if (job.settled) return;
    job.settled = true;
    job.removeAbortListener?.();
    job.resolve(result);
  }
}
