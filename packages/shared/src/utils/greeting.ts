export type GreetingKey = "morning" | "afternoon" | "evening" | "night";

interface Greeting {
  text: GreetingKey;
  emoji: string;
}

/**
 * Returns a time-appropriate greeting key with matching emoji
 * The text property is an i18n key to be used with t("greeting.{key}")
 */
export function getGreeting(): Greeting {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return { text: "morning", emoji: "🌅" };
  }
  if (hour >= 12 && hour < 17) {
    return { text: "afternoon", emoji: "☀️" };
  }
  if (hour >= 17 && hour < 21) {
    return { text: "evening", emoji: "🌆" };
  }
  return { text: "night", emoji: "🌙" };
}
