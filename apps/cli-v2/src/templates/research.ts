import type { MeshTemplate } from "./index.js";

export const template: MeshTemplate = {
  "name": "Research",
  "description": "Research and analysis mesh",
  "groups": [
    {
      "name": "analysis",
      "roles": [
        "lead",
        "analyst"
      ]
    }
  ],
  "stateKeys": {
    "topic": "Research topic",
    "deadline": "Due date"
  },
  "suggestedRoles": [
    "researcher",
    "analyst",
    "reviewer"
  ],
  "systemPromptHint": "You are part of a research team."
};

export default template;
