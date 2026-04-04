---
title: Chatbot
description: Build a powerful AI assistant with multiple LLMs, generative UI, web browsing, and image analysis.
url: /ai/docs/chat
---

# Chatbot

The [Chatbot](https://ai.turbostarter.dev/chat) demo application showcases an advanced AI assistant capable of engaging in complex conversations, performing web searches, and understanding context. It integrates multiple large language models (LLMs) and allows users to attach files to the chat window.

<AIAppShowcase id="chat" />

## Features

The chatbot offers a variety of capabilities for an enhanced conversational experience:

<Cards>
  <Card title="Multi-model integration">
    Switch effortlessly between leading AI providers like
    [OpenAI](/ai/docs/openai) and [Anthropic](/ai/docs/anthropic) within a
    single, consistent chat interface.
  </Card>

  <Card title="Deep reasoning">
    Experience an AI that truly understands complex questions and delivers
    thoughtful, nuanced responses based on comprehensive reasoning.
  </Card>

  <Card title="Live web information">
    Access up-to-the-minute information directly from the web through the
    integrated search capability powered by [Tavily AI](https://tavily.com/).
  </Card>

  <Card title="File sharing">
    Enrich conversations by sharing and analyzing files, images, or web links
    directly within the chat interface for contextual discussion.
  </Card>

  <Card title="Instant response delivery">
    Enjoy natural, fluid conversations with responses that stream in real-time,
    eliminating waiting periods.
  </Card>

  <Card title="Conversation history">
    Seamlessly manage your conversation history with features to save, organize,
    and revisit previous discussions.
  </Card>
</Cards>

## Setup

To implement your advanced AI assistant, you'll need several services configured. If you haven't set these up yet, start with:

<Cards>
  <Card href="/ai/docs/database" title="Database" description="Configure a PostgreSQL database to store conversation history and metadata." />

  <Card href="/ai/docs/storage" title="Storage" description="Set up S3-compatible storage for handling file attachments." />
</Cards>

### AI models

<Callout>
  Different models offer varying capabilities for tool calling, reasoning, and file processing. Consider these differences when selecting the optimal model for your specific use case.
</Callout>

The Chatbot leverages the AI SDK to support various language and vision models. You can easily switch between models based on your needs. Explore the documentation for the most popular models:

<Cards className="grid-cols-1 sm:grid-cols-2">
  <Card href="/ai/docs/openai" title="OpenAI" description="Implement GPT and o-series models for powerful text generation." icon={<OpenAI />} />

  <Card href="/ai/docs/anthropic" title="Anthropic" description="Integrate Claude models renowned for nuanced reasoning." icon={<Anthropic />} />

  <Card href="/ai/docs/google" title="Google AI" description="Incorporate Gemini models for versatile AI capabilities." icon={<Google />} />

  <Card href="/ai/docs/xai" title="xAI Grok" description="Leverage xAI's innovative Grok models for advanced interactions." icon={<XAI />} />
</Cards>

For detailed configuration of specific providers and other supported models, refer to the [AI SDK documentation](https://sdk.vercel.ai/providers/ai-sdk-providers).

### Web browsing

The chatbot utilizes [Tavily AI](https://tavily.com/) to provide real-time web search capabilities. Tavily is a specialized search engine optimized for LLMs and AI agents, designed to deliver highly relevant search results by automatically handling the complexities of web scraping, filtering, and extracting relevant information.

We selected Tavily because it dramatically simplifies the integration of current web data into AI applications through a single API call that returns comprehensive, AI-ready search results.

<Callout title="Free tier available">
  Tavily offers a generous free tier with [1,000 API credits per
  month](https://docs.tavily.com/documentation/api-credits) without requiring
  credit card information. A basic search consumes 1 credit, while an advanced
  search uses 2 credits. Paid plans are available for higher volume usage.
</Callout>

To enable web browsing, follow these steps:

<Steps>
  <Step>
    #### Get Tavily API Key

    Sign up or log in at the [Tavily Platform](https://app.tavily.com/sign-in) to obtain your API key from the dashboard.
  </Step>

  <Step>
    #### Add API Key to Environment

    Add your API key to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    TAVILY_API_KEY=tvly-your-api-key
    ```
  </Step>
</Steps>

With the API key properly configured, the chatbot will automatically utilize Tavily for searches when contextually appropriate.

## Data persistence

User interactions and chat history are persisted to ensure a continuous experience across sessions.

<Card href="/ai/docs/database" title="Database" description="Learn more about database service in TurboStarter AI." />

Conversation data is organized within a dedicated PostgreSQL schema named `chat`
to maintain clear separation from other application data.

* `chats`: stores records for each conversation session, including essential metadata like user ID and creation timestamp.
* `messages`: maintains the content of individual messages exchanged within conversations, linked to their parent chat session.
* `parts`: handles complex message structures by breaking down content into smaller components, particularly useful for generative UI elements or multi-modal content.

<Card href="/ai/docs/storage" title="Storage" description="Learn more about cloud storage service in TurboStarter AI." />

Files shared within conversations (such as images or documents) are uploaded to [cloud storage](/ai/docs/storage) (S3-compatible), with references to these attachments stored within the message content or parts.

## Structure

The Chatbot functionality is thoughtfully distributed across shared packages and platform-specific code for web and mobile, ensuring optimal code reuse and consistency.

### Core

The `@turbostarter/ai` package, located in `packages/ai`, contains the central chat functionality in the `src/chat` directory. It includes:

* Essential constants, types, and validation schemas for chat interactions
* Core API logic for managing conversations and messages
* Comprehensive chat history persistence and retrieval functionality
* AI model provider configuration and initialization
* Integrations for external tools like web search

### API

Built with Hono, the `packages/api` package defines all API endpoints. Chat-specific routes are organized under `src/modules/ai/chat`:

* `chat.router.ts`: establishes Hono RPC routes, handles input validation, and connects frontend requests to the core AI logic in `packages/ai`
* Manages authentication, request processing, and database interactions through the core package

### Web

The Next.js web application in `apps/web` implements the user-facing chat interface:

* `src/app/[locale]/(apps)/chat/**`: contains the Next.js App Router pages and layouts dedicated to the chat experience
* `src/components/chat/**`: houses reusable React components for the chat interface (message bubbles, input area, model selector, etc.)

### Mobile

The Expo/React Native mobile application in `apps/mobile` delivers a native chat experience:

* `src/app/chat/**`: defines the primary screens for the mobile chat interface
* `src/components/chat/**`: contains React Native components styled to match the web version, optimized for mobile interaction
* **API interaction**: utilizes the same Hono RPC client (`packages/api`) as the web app for consistent backend communication

This modular structure promotes separation of concerns and facilitates independent development and scaling of different parts of the application.
