---
title: Meta
description: Setup Meta's Llama models and learn how to use them in the starter kit via various hosting providers.
url: /ai/docs/meta
---

# Meta

The [Meta](https://ai.meta.com/) provider integration brings Meta's cutting-edge Llama family of open-weight models to your applications through the AI SDK. Renowned for their exceptional performance across diverse tasks, these models deliver state-of-the-art capabilities for your AI solutions.

![Meta Llama](/images/docs/ai/providers/meta.jpg)

## Setup

Deploying Llama models in your applications involves leveraging a third-party hosting provider that integrates seamlessly with the AI SDK, such as DeepInfra, Fireworks AI, Amazon Bedrock, Baseten, and others.

<Steps>
  <Step>
    ### Choose a hosting provider & get API Key

    Select a trusted provider that hosts Llama models (e.g., [DeepInfra](https://deepinfra.com/), [Fireworks AI](https://fireworks.ai/), or [Amazon Bedrock](https://aws.amazon.com/bedrock/)). Register with your preferred provider and generate a secure API key through their platform console.
  </Step>

  <Step>
    ### Add API Key to environment

    Add your provider-specific API key to your project's `.env` file (e.g., in `apps/web`). Use the appropriate environment variable for your chosen provider:

    ```bash title=".env"
    # Example for DeepInfra
    DEEPINFRA_API_KEY=your-deepinfra-api-key

    # Example for Fireworks AI
    FIREWORKS_API_KEY=your-fireworks-api-key

    # Example for Amazon Bedrock (requires AWS credentials)
    # AWS_ACCESS_KEY_ID=...
    # AWS_SECRET_ACCESS_KEY=...
    # AWS_REGION=...
    ```
  </Step>

  <Step>
    ### Configure provider

    When implementing AI SDK functions (`generateText`, `streamText`, etc.), initialize the client for your selected provider and specify the appropriate Llama model identifier:

    ```ts
    import { generateText } from "ai";
    import { deepinfra } from "@ai-sdk/deepinfra";
    // Or: import { fireworks } from '@ai-sdk/fireworks';
    // Or: import { bedrock } from '@ai-sdk/amazon-bedrock';

    const { text } = await generateText({
      // Example using DeepInfra
      model: deepinfra("meta-llama/Meta-Llama-3.1-8B-Instruct"),
      // Example using Fireworks AI
      // model: fireworks('accounts/fireworks/models/llama-v3p1-8b-instruct'),
      // Example using Amazon Bedrock
      // model: bedrock('meta.llama3-1-8b-instruct-v1:0'),
      prompt: "Why is the sky blue?",
    });
    ```

    For comprehensive implementation details, consult the AI SDK documentation for your specific provider: [DeepInfra](https://sdk.vercel.ai/providers/ai-sdk-providers/deepinfra), [Fireworks AI](https://sdk.vercel.ai/providers/ai-sdk-providers/fireworks), [Amazon Bedrock](https://sdk.vercel.ai/providers/ai-sdk-providers/amazon-bedrock), etc.
  </Step>
</Steps>

## Features

Llama models accessible through the AI SDK offer a range of powerful capabilities, with specific features varying based on model version and hosting provider implementation.

<Cards>
  <Card title="Chat Models" href="https://sdk.vercel.ai/docs/guides/llama-3_1">
    Utilize Llama's instruction-tuned models for dialogue generation,
    translation, reasoning, and other conversational tasks. Available in various
    sizes (e.g., 8B, 70B, 405B).
  </Card>

  <Card title="Tool Usage / Function Calling" href="https://sdk.vercel.ai/docs/guides/llama-3_1#using-tools-with-the-ai-sdk">
    Empower Llama models to interact with external tools and functions, enabling
    complex, multi-step task execution and real-world system integration.
    (Capabilities may vary depending on your selected provider).
  </Card>

  <Card title="Reasoning & Code Generation" href="https://ai.meta.com/blog/meta-llama-3-1/">
    Leverage Llama's capabilities for complex reasoning problems and generating
    code snippets in various programming languages.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="AI Chatbot">
    Create intelligent, responsive chatbots capable of natural conversations,
    accurate information retrieval, and efficient task execution. Experience
    this capability in our [Chat Demo](/ai/docs/chat).
  </Card>

  <Card title="Content Generation">
    Produce diverse, high-quality text content spanning articles, summaries,
    creative narratives, marketing copy, and more—tailored to your specific
    requirements.
  </Card>

  <Card title="Code Assistance">
    Boost developer productivity with AI-powered code generation, insightful
    code explanations, effective debugging assistance, and programming guidance
    across multiple languages.
  </Card>

  <Card title="Automated Workflows">
    Streamline operations by combining Llama models with tool usage capabilities
    to automate complex business processes and seamlessly interact with your
    existing systems.
  </Card>
</Cards>

## Links

* [Meta AI](https://ai.meta.com/)
* [Meta Llama Models](https://ai.meta.com/llama/)
* [AI SDK - Llama 3.1 Guide](https://sdk.vercel.ai/docs/guides/llama-3_1)
* [AI SDK - Providers](https://sdk.vercel.ai/providers) (Find hosting provider docs here)
