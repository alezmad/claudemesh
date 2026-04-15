import type { MeshTemplate } from "./index.js";

export const template: MeshTemplate = {
  "name": "Ops Incident",
  "description": "Incident response mesh",
  "groups": [
    {
      "name": "oncall",
      "roles": [
        "ic",
        "observer"
      ]
    }
  ],
  "stateKeys": {
    "severity": "Incident severity",
    "status": "Current status"
  },
  "suggestedRoles": [
    "ic",
    "oncall",
    "observer",
    "comms"
  ],
  "systemPromptHint": "You are part of an incident response team."
};

export default template;
