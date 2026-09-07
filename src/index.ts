import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerTools } from "./tools";

export default function extension(pi: ExtensionAPI) {
  registerTools(pi);
}
