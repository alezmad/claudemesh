import { loadConfig } from "../state/config";

export async function connectTelegram(args: string[]): Promise<void> {
  const config = loadConfig();
  if (config.meshes.length === 0) {
    console.error("No meshes joined. Run 'claudemesh join' first.");
    process.exit(1);
  }

  const mesh = config.meshes[0]!;
  const linkOnly = args.includes("--link");

  // Convert WS broker URL to HTTP
  const brokerHttp = mesh.brokerUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://")
    .replace("/ws", "");

  console.log("Requesting Telegram connect token...");

  const res = await fetch(`${brokerHttp}/tg/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meshId: mesh.meshId,
      memberId: mesh.memberId,
      pubkey: mesh.pubkey,
      secretKey: mesh.secretKey,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`Failed: ${(err as any).error ?? res.statusText}`);
    process.exit(1);
  }

  const { token, deepLink } = (await res.json()) as {
    token: string;
    deepLink: string;
  };

  if (linkOnly) {
    console.log(deepLink);
    return;
  }

  // Print QR code using simple block characters
  console.log("\n  Connect Telegram to your mesh:\n");
  console.log(`  ${deepLink}\n`);
  console.log("  Open this link on your phone, or scan the QR code");
  console.log("  with your Telegram camera.\n");

  // Try to generate QR with qrcode-terminal if available
  try {
    const QRCode = require("qrcode-terminal");
    QRCode.generate(deepLink, { small: true }, (code: string) => {
      console.log(code);
    });
  } catch {
    // qrcode-terminal not available, link is enough
    console.log("  (Install qrcode-terminal for QR code display)");
  }
}
