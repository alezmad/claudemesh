---
title: DeepSeek
description: Integrate DeepSeek's powerful AI models into your applications with minimal setup.
url: /ai/docs/deepseek
---

# DeepSeek

The [DeepSeek](https://www.deepseek.com/) provider delivers access to DeepSeek's advanced AI models through the AI SDK, bringing reasoning capabilities to your applications.

![DeepSeek](/images/docs/ai/providers/deepseek.webp)

## Setup

<Steps>
  <Step>
    ### Generate API Key

    Visit the [DeepSeek Platform](https://platform.deepseek.com/) and navigate to the API keys section to create your personal secret key.
  </Step>

  <Step>
    ### Add API Key to Environment

    Add your generated API key to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    DEEPSEEK_API_KEY=your-api-key
    ```
  </Step>

  <Step>
    ### Configure Provider (Optional)

    The starter kit automatically utilizes the `DEEPSEEK_API_KEY` environment variable. For advanced configurations, consult the comprehensive [AI SDK DeepSeek documentation](https://sdk.vercel.ai/providers/ai-sdk-providers/deepseek#provider-instance).
  </Step>
</Steps>

## Features

<Cards>
  <Card title="Chat Models" href="https://sdk.vercel.ai/providers/ai-sdk-providers/deepseek#language-models">
    Utilize DeepSeek's language models, known for their deep reasoning
    capabilities, for tasks like text generation, translation, and
    conversational AI applications.
  </Card>

  <Card title="Reasoning" href="https://platform.deepseek.com/">
    Tap into models with reasoning abilities designed specifically for complex
    problem-solving, logical deduction, and analytical tasks that require deep
    understanding.
  </Card>

  <Card title="Tool Usage / Function Calling" href="https://sdk.vercel.ai/providers/ai-sdk-providers/deepseek#tool-usage--function-calling">
    Enable language models to interact with external tools and functions,
    allowing for more complex and automated task execution.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="AI Chatbot">
    Create intelligent chatbots that engage in natural, meaningful conversations
    and assist users with a wide range of tasks. Experience this capability in
    our [Chat Demo](/ai/docs/chat).
  </Card>

  <Card title="Content Generation">
    Produce diverse, high-quality creative text content including articles,
    summaries, code explanations, and marketing copy with language
    understanding.
  </Card>

  <Card title="Automated Workflows">
    Integrate language models with other tools via function calling to automate
    processes like data analysis or report generation.
  </Card>
</Cards>

## Links

* [DeepSeek Website](https://www.deepseek.com/)
* [DeepSeek Platform](https://platform.deepseek.com/)
* [AI SDK - DeepSeek Provider Docs](https://sdk.vercel.ai/providers/ai-sdk-providers/deepseek)
