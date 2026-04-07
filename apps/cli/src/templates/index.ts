import devTeam from "./dev-team.json" with { type: "json" };
import research from "./research.json" with { type: "json" };
import opsIncident from "./ops-incident.json" with { type: "json" };
import simulation from "./simulation.json" with { type: "json" };
import personal from "./personal.json" with { type: "json" };

export interface MeshTemplate {
  name: string;
  description: string;
  groups: Array<{ name: string; roles: string[] }>;
  stateKeys: Record<string, string>;
  suggestedRoles: string[];
  systemPromptHint: string;
}

export const TEMPLATES: Record<string, MeshTemplate> = {
  "dev-team": devTeam,
  research,
  "ops-incident": opsIncident,
  simulation,
  personal,
};

export function listTemplates(): MeshTemplate[] {
  return Object.values(TEMPLATES);
}

export function getTemplate(name: string): MeshTemplate | undefined {
  return TEMPLATES[name];
}
