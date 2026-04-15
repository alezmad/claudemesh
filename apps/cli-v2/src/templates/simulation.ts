import type { MeshTemplate } from "./index.js";

export const template: MeshTemplate = {
  "name": "Simulation",
  "description": "Multi-agent simulation mesh",
  "groups": [
    {
      "name": "actors",
      "roles": [
        "agent",
        "observer"
      ]
    }
  ],
  "stateKeys": {
    "scenario": "Simulation scenario",
    "turn": "Current turn"
  },
  "suggestedRoles": [
    "agent",
    "observer",
    "narrator"
  ],
  "systemPromptHint": "You are an agent in a simulation."
};

export default template;
