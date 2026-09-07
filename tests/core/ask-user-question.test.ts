import { describe, expect, it } from "vitest";

import {
  buildDetails,
  normalizeQuestions,
} from "../../src/core/ask-user-question";

describe("ask-user-question core", () => {
  it("normalizes the single-question and builds selected answer details", () => {
    const questions = normalizeQuestions({
      questions: [
        {
          prompt: "Which output format?",
          label: "Format",
          choices: ["Summary", "JSON"],
        },
      ],
    });

    expect(questions[0]).toMatchObject({
      question: "Which output format?",
      header: "Format",
      allowOther: true,
    });

    const details = buildDetails(
      questions,
      new Map([[0, { selectedIndices: [1] }]]),
      false,
    );

    expect(details.answers).toEqual({ "Which output format?": "JSON" });
    expect(details.selections[0]?.selectedIndices).toEqual([2]);
  });

  it("normalizes the multi-question and preserves multiple selections", () => {
    const questions = normalizeQuestions({
      questions: [
        {
          question: "Which output format?",
          header: "Format",
          options: ["Summary", "JSON"],
        },
        {
          question: "Which sections should be included?",
          header: "Sections",
          options: ["Result", "Troubleshooting"],
          multiSelect: true,
        },
      ],
    });

    const details = buildDetails(
      questions,
      new Map([
        [0, { selectedIndices: [0] }],
        [1, { selectedIndices: [0, 1] }],
      ]),
      false,
    );

    expect(details.answers).toEqual({
      "Which output format?": "Summary",
      "Which sections should be included?": ["Result", "Troubleshooting"],
    });
    expect(details.selections[1]?.selectedIndices).toEqual([1, 2]);
  });
});
