export interface TelegramConnectorConfig {
  // Telegram
  telegramBotToken: string; // from @BotFather
  telegramChatId: string; // group chat or user chat ID

  // Mesh
  brokerUrl: string;
  meshId: string;
  memberId: string;
  pubkey: string;
  secretKey: string;
  displayName: string; // e.g. "Telegram-DevChat"
}

export function loadConfigFromEnv(): TelegramConnectorConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramChatId: required("TELEGRAM_CHAT_ID"),
    brokerUrl: required("BROKER_URL"),
    meshId: required("MESH_ID"),
    memberId: required("MEMBER_ID"),
    pubkey: required("PUBKEY"),
    secretKey: required("SECRET_KEY"),
    displayName: process.env.DISPLAY_NAME || "Telegram",
  };
}
