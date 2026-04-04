---
title: Text to Speech
description: Convert text into natural-sounding speech using advanced AI voice synthesis models.
url: /ai/docs/tts
---

# Text to Speech

The [Text to Speech (TTS)](https://ai.turbostarter.dev/tts) demo application transforms written text into high-quality spoken audio. It leverages state-of-the-art AI models to generate lifelike voices in various languages and styles.

<AIAppShowcase id="tts" />

## Features

Discover the powerful capabilities of this AI-powered voice synthesis solution:

<Cards>
  <Card title="5,000+ voices">
    Access a wide range of voices from providers like [Eleven
    Labs](https://elevenlabs.io/), including different accents, ages, and
    emotional tones, to find the perfect match for your content.
  </Card>

  <Card title="Real-time audio streaming">
    Experience near-instantaneous audio generation with streaming delivery,
    providing immediate feedback as your content comes to life.
  </Card>

  <Card title="Integrated audio player">
    Enjoy a full-featured playback interface with precise controls for playback
    speed and convenient options to download generated audio files.
  </Card>

  <Card title="Voice customization">
    Fine-tune your audio output with adjustable parameters for pitch, speed, and
    pauses, creating the most natural and engaging delivery possible (available
    options vary by provider).
  </Card>

  <Card title="Intuitive user experience">
    Benefit from a thoughtfully designed interface that makes transforming text
    to speech effortless and efficient, even for first-time users.
  </Card>
</Cards>

## AI models

This application primarily utilizes specialized text-to-speech models from [Eleven Labs](https://elevenlabs.io/).

<Cards>
  <Card href="/ai/docs/eleven-labs" title="Eleven Labs" description="Integrate Eleven Labs' state-of-the-art voice synthesis technology for stunningly realistic and expressive speech generation." icon={<ElevenLabs />} />
</Cards>

For comprehensive information about available voices and advanced customization techniques, consult the [ElevenLabs SDK documentation](https://elevenlabs.io/docs/overview).

## Structure

The Text-to-Speech feature is organized across the monorepo for maximum flexibility and maintainability:

### Core

The `@turbostarter/ai` package (`packages/ai`) contains the essential logic under `modules/tts`:

* Comprehensive types, validation schemas, and constants specific to TTS functionality
* Core API logic for processing text-to-speech requests and interfacing with AI models
* Robust handling of generated audio file uploads to cloud storage

### API

The `packages/api` package defines the backend API endpoints using [Hono](https://hono.dev/):

* `src/modules/ai/tts/tts.router.ts`: implements Hono RPC routes for TTS generation, handles input validation, applies critical middleware (authentication, credit management), and invokes the core functionality from `@turbostarter/ai`.

### Web

The [Next.js](https://nextjs.org/) application (`apps/web`) provides the user interface:

* `src/app/[locale]/(apps)/tts/**`: contains the Next.js App Router pages and layouts for the TTS experience
* `src/components/tts/**`: houses reusable React components specific to the TTS interface (text input area, voice selector, audio player, etc.)

### Mobile

The [Expo](https://expo.dev/)/[React Native](https://reactnative.dev/) application (`apps/mobile`) provides the native mobile experience:

* `src/app/tts/**`: defines the screens for the mobile TTS interface
* `src/components/tts/**`: contains React Native components optimized for the mobile experience
* **API interaction**: utilizes the same Hono RPC client (`packages/api`) as the web app for consistent communication with the backend

This architecture ensures perfect consistency between platforms while allowing for optimized UI implementations tailored to each environment.
