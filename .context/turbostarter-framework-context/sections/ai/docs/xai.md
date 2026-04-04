---
title: xAI Grok
description: Setup xAI provider and learn how to use it in the starter kit.
url: /ai/docs/xai
---

# xAI Grok

The [xAI](https://x.ai) provider integrates Grok models into your application using the AI SDK.

![xAI Grok](/images/docs/ai/providers/xai.webp)

## Setup

<Steps>
  <Step>
    ### Generate API Key

    Visit the [xAI website](https://x.ai) to create an account. After signing in, navigate to your account settings to generate an API key.
  </Step>

  <Step>
    ### Add API Key to Environment

    Once you've acquired an API key, add it to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    XAI_API_KEY=your-api-key
    ```
  </Step>

  <Step>
    ### Configure Provider (Optional)

    The starter kit automatically uses the `XAI_API_KEY` environment variable. For advanced configurations and customization options, refer to the comprehensive [AI SDK xAI documentation](https://sdk.vercel.ai/providers/ai-sdk-providers/xai#provider-instance).
  </Step>
</Steps>

## Features

<Cards>
  <Card title="Chat Models" href="https://sdk.vercel.ai/providers/ai-sdk-providers/xai#language-models">
    Utilize xAI's language models for conversational AI, text generation, and
    other natural language processing tasks.
  </Card>

  <Card title="Tool Usage / Function Calling" href="https://sdk.vercel.ai/providers/ai-sdk-providers/xai#tool-usage--function-calling">
    Enable language models to interact with external tools and functions,
    allowing for more complex and automated task execution.
  </Card>

  <Card title="Image Generation" href="https://sdk.vercel.ai/providers/ai-sdk-providers/xai#image-models">
    Generate images based on textual descriptions using xAI's models.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="AI Chatbot">
    Create intelligent chatbots that engage users in natural, informative
    conversations powered by xAI's Grok models, delivering responsive and
    contextually relevant interactions. Experience this capability in our [Chat
    Demo](/ai/docs/chat).
  </Card>

  <Card title="Content Generation">
    Produce diverse, high-quality text content across various formats and
    styles, harnessing the unique characteristics and capabilities of Grok
    models for creative and informational outputs.
  </Card>

  <Card title="Automated Workflows">
    Streamline operations by connecting xAI's language models with your existing
    tools through function calling, enabling sophisticated automation of complex
    business processes and repetitive tasks.
  </Card>

  <Card title="Image Generation">
    Design striking visuals and artwork directly from text descriptions using
    xAI's image generation capabilities, enabling creative applications and rich
    visual content. Explore our [Image Generation Demo](/ai/docs/image) to see
    these features in action.
  </Card>
</Cards>

## Links

* [xAI Website](https://x.ai)
* [AI SDK - xAI Provider Docs](https://sdk.vercel.ai/providers/ai-sdk-providers/xai)
