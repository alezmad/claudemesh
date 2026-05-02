import { readConfig } from "~/services/config/facade.js";
import { render } from "~/ui/render.js";
import { dim } from "~/ui/styles.js";

export async function connectTelegram(args: string[]): Promise<void> {
  const config = readConfig();
  if (config.meshes.length === 0) {
    render.err("No meshes joined.", "Run `claudemesh join` first.");
    process.exit(1);
  }

  const mesh = config.meshes[0]!;
  const linkOnly = args.includes("--link");

  const brokerHttp = mesh.brokerUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://")
    .replace("/ws", "");

  render.info(dim("Requesting Telegram connect token…"));

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
    render.err(`Failed: ${(err as any).error ?? res.statusText}`);
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

  render.section("connect Telegram to your mesh");
  render.link(deepLink);
  render.blank();
  render.info(dim("Open this link on your phone, or scan the QR code with your Telegram camera."));
  render.blank();

  try {
    const QRCode = require("qrcode-terminal");
    QRCode.generate(deepLink, { small: true }, (code: string) => {
      console.log(code);
    });
  } catch {
    render.info(dim("(Install qrcode-terminal for QR code display)"));
  }
}
