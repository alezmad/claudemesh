import { login } from "./login.js";

// Register and login use the same device-code flow.
// The browser page (/cli-auth) redirects to /auth/login if not authenticated,
// which has a "Don't have an account? Register" link.
export async function register(): Promise<number> {
  return login();
}
