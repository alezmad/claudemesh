---
title: Internationalization
description: Learn how we manage internationalization in TurboStarter AI.
url: /ai/docs/internationalization
---

# Internationalization

TurboStarter AI builds on the core internationalization (i18n) setup from the main TurboStarter framework. The shared `@turbostarter/i18n` package in `packages/i18n` handles translation management across platforms.

This gives you the benefit of a proven system using [i18next](https://www.i18next.com/) for managing translations on both web and mobile apps. Plus, the AI models and LLMs integrated within TurboStarter AI generally support multiple languages, enabling interactions beyond what's covered by UI translations alone.

For detailed information on configuring languages, adding translations, or using the `useTranslation` hook, check out the core documentation:

<Cards>
  <Card title="Web internationalization" description="Learn about i18n setup for the Next.js web app." href="/docs/web/internationalization/overview" />

  <Card title="Mobile internationalization" description="Learn about i18n setup for the React Native (Expo) mobile app." href="/docs/mobile/internationalization" />
</Cards>

## AI-specific translations

While most translations are shared across the platform, TurboStarter AI introduces a dedicated `ai` namespace within translation files. This namespace contains strings specifically for AI features, demo applications, and UI elements unique to the AI starter kit.

```json title="packages/i18n/locales/en/ai.json"
{
  "chat": {
    "title": "AI Chatbot",
    "description": "Engage in intelligent conversations."
  },
  "image": {
    "title": "Image Generation",
    "description": "Create stunning visuals with AI."
  }
  // ... other AI-specific translations
}
```

When adding translations for new AI features or modifying existing ones, place them within the `ai` namespace in the appropriate language files (e.g., `en/ai.json`, `es/ai.json`). This keeps AI-related text organized and separate from core application translations.
