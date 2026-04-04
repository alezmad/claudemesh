---
title: OpenAI
description: Setup OpenAI provider and learn how to use it in the starter kit.
url: /ai/docs/openai
---

# OpenAI

The [OpenAI](https://openai.com) provider integrates OpenAI's powerful suite of language models, image generation capabilities, and embedding technologies into your application through the AI SDK.

![OpenAI](/images/docs/ai/providers/openai.png)

## Setup

<Steps>
  <Step>
    ### Generate API Key

    Visit the [OpenAI API keys page](https://platform.openai.com/api-keys) to create your personal secret key for API access.
  </Step>

  <Step>
    ### Add API Key to Environment

    Add your API key to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    OPENAI_API_KEY=your-api-key
    ```
  </Step>

  <Step>
    ### Configure Provider (Optional)

    By default, the starter kit automatically uses the `OPENAI_API_KEY` environment variable. For advanced configurations (such as using a proxy or specific organization ID), you can customize the provider instance. For detailed options, refer to the [AI SDK OpenAI documentation](https://sdk.vercel.ai/providers/ai-sdk-providers/openai#provider-instance).
  </Step>
</Steps>

## Features

<Cards>
  <Card title="Chat Models" href="https://sdk.vercel.ai/providers/ai-sdk-providers/openai#language-models">
    Leverage state-of-the-art models for building sophisticated conversational
    AI, generating creative text formats, and answering complex questions.
  </Card>

  <Card title="Embedding Models" href="https://sdk.vercel.ai/providers/ai-sdk-providers/openai#embedding-models">
    Transform text into rich numerical representations with powerful models like
    `text-embedding-3-large`, enabling advanced semantic search, intelligent
    text clustering, and highly personalized recommendation systems.
  </Card>

  <Card title="Image Generation (DALL·E)" href="https://sdk.vercel.ai/providers/ai-sdk-providers/openai#image-generation-models">
    Generate unique images from textual descriptions using OpenAI's DALL·E
    models, enabling creative applications and content generation.
  </Card>

  <Card title="Speech Generation (TTS)" href="https://sdk.vercel.ai/providers/ai-sdk-providers/openai#speech-generation-models">
    Convert written text into natural-sounding human speech with various voices
    using Text-to-Speech (TTS) models, ideal for accessibility features or voice
    interfaces.
  </Card>

  <Card title="Vision / Image Input" href="https://sdk.vercel.ai/providers/ai-sdk-providers/openai#vision--image-input">
    Empower models like GPT-4o or GPT-4 Turbo with Vision capabilities to
    understand, analyze, and describe the content of images provided in prompts.
  </Card>

  <Card title="Tool Usage / Function Calling" href="https://sdk.vercel.ai/providers/ai-sdk-providers/openai#tool-usage--function-calling">
    Allow language models to intelligently interact with your external tools,
    APIs, and custom functions, orchestrating complex multi-step tasks and
    creating powerful AI agents that can take actions in the real world.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="AI Chatbot">
    Create intelligent, context-aware conversational agents that engage in
    natural dialogue, answer complex questions, and complete sophisticated tasks
    based on user needs. Experience this capability in our [Chat
    Demo](/ai/docs/chat).
  </Card>

  <Card title="Content Generation">
    Automate the creation of diverse text-based content, including blog posts,
    marketing copy, emails, code snippets, and creative writing pieces.
  </Card>

  <Card title="Semantic Search & RAG">
    Build advanced search systems that truly understand the meaning behind user
    queries, enhanced with Retrieval-Augmented Generation (RAG) for delivering
    exceptionally accurate, contextually relevant answers from your data.
  </Card>

  <Card title="Image Generation & Analysis">
    Develop applications that can generate images from text prompts or analyze
    and interpret the content of existing images for tagging, description, or
    moderation. Check out the [Image Generation Demo](/ai/docs/image).
  </Card>

  <Card title="Text-to-Speech Applications">
    Design engaging voice-enabled experiences, including lifelike virtual
    assistants, expressive audiobook narration, real-time translation services,
    and accessibility tools that convert text to natural speech for visually
    impaired users.
  </Card>

  <Card title="Automated Workflows">
    Transform business processes by connecting powerful language models to your
    existing tools and systems through function calling, automating complex
    workflows for data processing, report generation, customer support, and
    more.
  </Card>
</Cards>

## Links

* [OpenAI Website](https://openai.com/)
* [OpenAI API Documentation](https://platform.openai.com/docs)
* [AI SDK - OpenAI Provider Docs](https://sdk.vercel.ai/providers/ai-sdk-providers/openai)
