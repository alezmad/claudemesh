---
title: Eleven Labs
description: Setup ElevenLabs and learn how to integrate its AI audio capabilities into the starter kit.
url: /ai/docs/eleven-labs
---

# Eleven Labs

[ElevenLabs](https://elevenlabs.io/) stands at the forefront of AI audio innovation, specializing in ultra-realistic Text-to-Speech (TTS), voice cloning, and advanced audio generation. While not a native provider within the AI SDK core, ElevenLabs' powerful services integrate seamlessly with AI applications to deliver exceptional voice experiences.

![ElevenLabs](/images/docs/ai/providers/elevenlabs.jpg)

## Setup

Integrating ElevenLabs involves using their purpose-built SDKs (Python, TypeScript/JavaScript) alongside your application logic:

<Steps>
  <Step>
    ### Generate API Key

    Visit the [ElevenLabs website](https://elevenlabs.io/), create an account or sign in, then navigate to your profile settings to generate your unique API key.
  </Step>

  <Step>
    ### Add API Key to Environment

    Add your API key to your project's `.env` file (e.g., in `apps/web` or the appropriate package):

    ```bash title=".env"
    ELEVENLABS_API_KEY=your-api-key
    ```
  </Step>

  <Step>
    ### Configure SDK

    Initialize the ElevenLabs client with your API key:

    ```typescript title="client.ts"
    import { ElevenLabsClient } from "elevenlabs";

    import { env } from "../../env";

    export const client = new ElevenLabsClient({
      apiKey: env.ELEVENLABS_API_KEY,
    });
    // Now use the client object...
    ```

    For comprehensive implementation details, refer to the [ElevenLabs Quickstart Guide](https://elevenlabs.io/docs/quickstart).
  </Step>
</Steps>

## Features

ElevenLabs offers a comprehensive suite of AI audio technologies:

<Cards>
  <Card title="Text to Speech (TTS)" href="https://elevenlabs.io/docs/capabilities/text-to-speech">
    Transform written text into remarkably natural speech across numerous
    languages, voices, and styles, with flexible options for quality or
    low-latency delivery.
  </Card>

  <Card title="Speech to Text (STT)" href="https://elevenlabs.io/docs/capabilities/speech-to-text">
    Transcribe spoken audio into text accurately, supporting multiple languages
    and providing features like speaker diarization.
  </Card>

  <Card title="Voice Cloning" href="https://elevenlabs.io/docs/capabilities/voice-cloning">
    Create stunningly accurate digital replicas of voices from audio samples,
    with both instant and professional-grade options to suit your needs.
  </Card>

  <Card title="Voice Design" href="https://elevenlabs.io/docs/capabilities/voice-design">
    Craft entirely new, unique synthetic voices based on descriptive parameters,
    enabling custom voice creation without requiring sample recordings.
  </Card>

  <Card title="Conversational AI Platform" href="https://elevenlabs.io/docs/conversational-ai/overview">
    Build and deploy end-to-end conversational voice agents, integrating STT,
    LLMs (like GPT, Claude, Gemini), TTS, and turn-taking logic.
  </Card>

  <Card title="Dubbing" href="https://elevenlabs.io/docs/capabilities/dubbing">
    Automatically dub audio or video content into different languages while
    preserving the original voice characteristics.
  </Card>

  <Card title="Sound Effects" href="https://elevenlabs.io/docs/capabilities/sound-effects">
    Create custom sound effects and ambient audio from simple text descriptions,
    adding rich audio elements to your applications.
  </Card>

  <Card title="Voice Library" href="https://elevenlabs.io/voice-library">
    Access an extensive collection of pre-made, ready-to-use voices contributed
    by the ElevenLabs community.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="Real-time Voice Agents">
    Power conversational AI applications like customer service bots, virtual
    assistants, or interactive characters with low-latency TTS.
  </Card>

  <Card title="Audiobook & Narration">
    Create professional-quality narration for audiobooks, articles, videos, and
    e-learning content in multiple languages and voices. Experience this in the
    [TTS Demo](/ai/docs/tts).
  </Card>

  <Card title="Accessibility">
    Enhance digital accessibility by converting text content into natural
    speech, making your applications more inclusive for users with visual
    impairments or reading difficulties.
  </Card>

  <Card title="Personalized Content">
    Deliver dynamic, personalized audio experiences with custom-designed or
    cloned voices, creating unique and engaging user interactions.
  </Card>

  <Card title="Global Content Creation">
    Utilize dubbing and multilingual TTS to easily adapt content for
    international audiences.
  </Card>

  <Card title="Gaming & Entertainment">
    Generate character voices, ambient sounds, and dynamic audio for immersive
    experiences.
  </Card>
</Cards>

## Links

* [ElevenLabs Website](https://elevenlabs.io/)
* [ElevenLabs Documentation](https://elevenlabs.io/docs)
* [Developer Quickstart](https://elevenlabs.io/docs/quickstart)
* [API Reference](https://elevenlabs.io/docs/api-reference/introduction)
* [Pricing](https://elevenlabs.io/pricing)
