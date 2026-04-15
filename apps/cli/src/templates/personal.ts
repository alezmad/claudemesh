import type { MeshTemplate } from "./index.js";

export const template: MeshTemplate = {
  "name": "Personal",
  "description": "Personal workspace mesh",
  "groups": [],
  "stateKeys": {
    "focus": "Current focus"
  },
  "suggestedRoles": [
    "assistant",
    "researcher"
  ],
  "systemPromptHint": "You are a personal assistant."
};

export default template;
