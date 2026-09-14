import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { QuestionnaireService } from "../runtime/questionnaire-service";
import { registerAskUserQuestionTool } from "./ask-user-question";

export function registerTools(
  pi: ExtensionAPI,
  service = new QuestionnaireService(),
) {
  registerAskUserQuestionTool(pi, service);
  return service;
}
