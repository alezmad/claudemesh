import type { MeshTemplate } from "./index.js";

export const template: MeshTemplate = {
  "name": "Dev Team",
  "description": "Software development team mesh",
  "groups": [
    {
      "name": "eng",
      "roles": [
        "lead",
        "member"
      ]
    },
    {
      "name": "qa",
      "roles": [
        "lead",
        "member"
      ]
    }
  ],
  "stateKeys": {
    "sprint": "Current sprint name",
    "board_url": "Task board URL"
  },
  "suggestedRoles": [
    "dev",
    "qa",
    "lead",
    "devops"
  ],
  "systemPromptHint": "You are part of a software development team."
};

export default template;
