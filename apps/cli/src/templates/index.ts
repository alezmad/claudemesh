export interface MeshTemplate { name: string; description: string; groups: Array<{ name: string; roles: string[] }>; stateKeys: Record<string, string>; suggestedRoles: string[]; systemPromptHint: string; }

import { template as devTeam } from "./dev-team.js";
import { template as research } from "./research.js";
import { template as opsIncident } from "./ops-incident.js";
import { template as simulation } from "./simulation.js";
import { template as personal } from "./personal.js";

export const TEMPLATES: Record<string, MeshTemplate> = { "dev-team": devTeam, research, "ops-incident": opsIncident, simulation, personal };
export function listTemplates(): MeshTemplate[] { return Object.values(TEMPLATES); }
export function getTemplate(name: string): MeshTemplate | undefined { return TEMPLATES[name]; }
