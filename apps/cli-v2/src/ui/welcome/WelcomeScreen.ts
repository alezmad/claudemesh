import { bold, green, dim, orange, icons } from "../styles.js";

export function renderWelcome(): void {
  console.log("");
  console.log("  " + orange("Welcome to claudemesh"));
  console.log("  " + dim("Peer mesh for Claude Code sessions"));
  console.log("");
  console.log("  What would you like to do?");
  console.log("");
  console.log("    " + bold("1)") + " " + green("Register") + " a new account");
  console.log("    " + bold("2)") + " " + green("Login") + " to an existing account");
  console.log("    " + bold("3)") + " " + green("Join") + " a mesh from an invite link");
  console.log("    " + bold("4)") + " Exit");
  console.log("");
}
