---
title: API
description: Overview of the API service in TurboStarter AI, including its architecture, technology stack, and core functionalities.
url: /ai/docs/api
---

# API

The API service acts as the central hub for all backend logic within TurboStarter AI. It handles interactions with AI models, data processing, and communication between the frontend and backend systems.

## Technology

We use [Hono](https://hono.dev), a lightning-fast web framework optimized for edge computing. This ensures efficient handling of API requests—particularly critical for real-time AI interactions like streaming responses.

**Importantly, this single API layer serves both web and mobile applications, guaranteeing consistent business logic and data handling across all platforms.**

## AI integration

While the API package (`@turbostarter/api`) exposes the endpoints, the core AI logic lives in a dedicated package: `@turbostarter/ai`. This package is strictly responsible for:

* Communicating with various AI providers and models ([OpenAI](/ai/docs/openai), [Anthropic](/ai/docs/anthropic), [Google AI](/ai/docs/google), etc.)
* Processing and formatting data specifically for AI interactions
* Parsing responses from AI models
* Handling AI-specific data storage or retrieval when necessary

The `@turbostarter/api` package utilizes `@turbostarter/ai` to perform these AI tasks. The API layer itself focuses on registering Hono routes, applying middlewares (like authentication and validation), and exposing AI functionalities to the frontend applications.

This separation ensures AI-specific logic remains modular and reusable, while the API package stays focused on request handling and routing.

<Callout>
  API keys for AI services are managed securely on the backend within these packages, ensuring they never appear client-side.
</Callout>

## Middlewares

Hono middlewares streamline request handling by tackling common tasks before the main logic runs. In TurboStarter AI, they handle:

* **Authentication:** verifying user sessions to protect routes, ensuring only logged-in users access certain features
* **Validation:** using schemas to check if incoming request data (like query parameters or JSON bodies) matches expected formats, preventing invalid data from reaching route handlers
* **Rate limiting:** shielding the API from abuse by restricting the number of requests a user or IP address can make within a given timeframe
* **Credits management:** automatically checking if a user has enough credits for an AI operation and deducting the cost before proceeding
* **Localization:** detecting the user's preferred language to deliver localized responses and error messages

These middlewares keep core route logic clean and focused, while consistently enforcing security, usage limits, and data integrity across the API.

## Core API documentation

For general information about the API setup, architecture, authentication integration, and how to add new endpoints, please refer to the [Core API documentation](/docs/web/api/overview).

<Card title="API documentation" href="/docs/web/api/overview" description="Learn about the general API setup, structure, and best practices in the core TurboStarter documentation." />

Specific configurations related to AI providers or demo apps can be found in their respective documentation sections.
