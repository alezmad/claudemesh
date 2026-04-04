import { initialize } from "@turbostarter/monitoring-web/server";
import { validateRuntimeEnv } from "@turbostarter/shared/validate-env";

export function register() {
  validateRuntimeEnv();
  initialize();
}

export { onRequestError } from "@turbostarter/monitoring-web/server";
