---
title: Image Generation
description: Learn how to generate images using AI models within the TurboStarter AI demo application.
url: /ai/docs/image
---

# Image Generation

The [Image Generation](https://ai.turbostarter.dev/image) demo application allows users to create unique visuals from textual descriptions using various AI models. It provides a simple interface to input prompts, select models, and view generated images.

<AIAppShowcase id="image" />

## Features

Explore the capabilities of the AI-powered image generation tool:

<Cards>
  <Card title="Prompt-based generation">
    Create images simply by describing what you want to see in text.
  </Card>

  <Card title="Multi-model support">
    Choose from different AI image generation models offered by various
    providers.
  </Card>

  <Card title="Aspect ratio control">
    Select the desired aspect ratio for your generated images (e.g. square,
    landscape, portrait).
  </Card>

  <Card title="Batch generation">
    Create multiple design variations from a single prompt simultaneously,
    accelerating your creative workflow.
  </Card>

  <Card title="Generation history">
    Access and reference your complete generation history, including all prompts
    and resulting images for continued iteration.
  </Card>
</Cards>

## Setup

To implement image generation in your application, you'll need to configure the necessary backend services.

<Cards>
  <Card href="/ai/docs/database" title="Database" description="Configure a PostgreSQL database to store generation history and image metadata." />

  <Card href="/ai/docs/storage" title="Storage" description="Set up S3-compatible storage to securely manage generated image assets." />
</Cards>

You'll also need API keys for your preferred AI models. Follow the detailed setup instructions in the provider documentation linked below.

## AI models

The Image Generation app leverages the AI SDK to support various models capable of creating images from text. Configure the providers for the models you wish to use:

<Cards>
  <Card href="/ai/docs/openai" title="OpenAI" description="Implement DALL·E models for exceptional image quality and creative fidelity." icon={<OpenAI />} />

  <Card href="/ai/docs/replicate" title="Replicate" description="Access a diverse ecosystem of open-source models including Stable Diffusion variants." icon={<Replicate />} />
</Cards>

For detailed implementation guidance, refer to the [AI SDK documentation](https://sdk.vercel.ai/docs/ai-sdk-core/image-generation) covering the `generateImage` function and supported providers.

## Data persistence

Details about image generation requests and the resulting images are stored to maintain user history.

<Card href="/ai/docs/database" title="Database" description="Learn more about database services in TurboStarter AI." />

Data is organized within a dedicated PostgreSQL schema named `image`:

* `generations`: captures detailed information about each generation request, including the `prompt`, selected `model`, `aspectRatio`, requested image `count`, `userId`, and precise timestamps.
* `images`: stores complete metadata for each generated image, linked to its parent `generation` record via `generationId` and maintaining the `url` reference to the stored image file.

<Card href="/ai/docs/storage" title="Storage" description="Learn more about cloud storage services in TurboStarter AI." />

The generated image files are securely stored in [cloud storage](/ai/docs/storage) (S3-compatible). Each image's location is tracked via the `url` field in the `images` table for reliable retrieval.

## Structure

The Image Generation feature is architected across the monorepo for optimal code organization and reusability.

### Core

The `@turbostarter/ai` package (`packages/ai`) contains the essential logic under `modules/image`:

* Comprehensive types, validation schemas (for prompts, aspect ratios, etc.), and constants
* Core API logic for processing image generation requests and interfacing with AI models
* Database operations for recording generation details and image metadata
* Utilities for uploading generated images to cloud storage

### API

The `packages/api` package defines the backend API endpoints using Hono:

* `src/modules/ai/image/image.router.ts`: implements Hono RPC routes for image generation, handles input validation, applies necessary middleware (authentication, credit management), and invokes the core logic from `@turbostarter/ai`.

### Web

The Next.js application (`apps/web`) delivers an intuitive user interface:

* `src/app/[locale]/(apps)/image/**`: contains the Next.js App Router pages and layouts for the image generation experience
* `src/components/image/**`: houses reusable React components tailored to the image generation UI (prompt input, model selector, image gallery, etc.)

### Mobile

The Expo/React Native application (`apps/mobile`) provides a native mobile experience:

* `src/app/image/**`: defines the screens for the mobile image generation interface
* `src/components/image/**`: contains React Native components optimized for mobile interaction
* **API integration**: utilizes the same Hono RPC client (`packages/api`) as the web app for consistent backend communication

This architecture ensures perfect consistency across platforms while enabling tailored UI implementations optimized for each environment.
