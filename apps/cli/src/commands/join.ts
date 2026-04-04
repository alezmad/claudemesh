/**
 * `claudemesh join <invite-link>` — parse a mesh invite link and
 * join the mesh.
 *
 * STUB: real invite-link parsing + keypair generation + broker
 * enrollment lands in Step 17. For now this just validates the link
 * shape and tells the user what's coming.
 */

export function runJoin(args: string[]): void {
  const link = args[0];
  if (!link) {
    console.error("Usage: claudemesh join <invite-link>");
    console.error("");
    console.error("Example: claudemesh join ic://join/BASE64URL...");
    process.exit(1);
  }
  if (!link.startsWith("ic://join/")) {
    console.error(
      `claudemesh: invalid invite link. Expected ic://join/... got "${link}"`,
    );
    process.exit(1);
  }
  console.log("claudemesh: join not yet implemented (Step 17).");
  console.log(`  Invite link parsed: ${link.slice(0, 40)}...`);
  console.log(
    "  Real flow will: verify sig, generate keypair, enroll member, persist to ~/.claudemesh/config.json",
  );
  process.exit(0);
}
