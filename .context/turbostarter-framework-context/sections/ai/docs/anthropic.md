---
title: Anthropic
description: Setup Anthropic provider and learn how to use it in the starter kit.
url: /ai/docs/anthropic
---

# Anthropic

The [Anthropic](https://www.anthropic.com) provider integrates Anthropic's powerful Claude models into your application through the AI SDK, with an emphasis on safety, helpfulness, and natural interactions.

![Anthropic](/images/docs/ai/providers/anthropic.png)

## Setup

<Steps>
  <Step>
    ### Generate API Key

    Visit the [Anthropic Console](https://console.anthropic.com/) to create an account and generate a new API key for your project.
  </Step>

  <Step>
    ### Add API Key to Environment

    Add your generated API key to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    ANTHROPIC_API_KEY=your-api-key
    ```
  </Step>

  <Step>
    ### Configure Provider (Optional)

    The starter kit automatically uses the `ANTHROPIC_API_KEY` environment variable. For advanced configurations (such as proxies or custom headers), refer to the [AI SDK Anthropic documentation](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#provider-instance).
  </Step>
</Steps>

## Features

<Cards>
  <Card title="Language Models" href="https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#language-models">
    Leverage Anthropic's state-of-the-art Claude models for sophisticated
    conversational AI, creative text generation, in-depth analysis, and more
    through the intuitive Messages API.
  </Card>

  <Card title="Image Input / Vision" href="https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#image-input">
    Enable models to understand and process image inputs alongside text for
    multimodal applications.
  </Card>

  <Card title="Tool Usage / Function Calling" href="https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#tool-usage">
    Allow models to interact with external tools and APIs to perform actions and
    retrieve real-time information.
  </Card>

  <Card title="Object Generation" href="https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#object-generation">
    Create structured data outputs (like JSON) from natural language prompts,
    streamlining the integration of AI capabilities with your existing systems.
  </Card>

  <Card title="Reasoning" href="https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#reasoning">
    Access detailed insights into the model's thought process, enhancing
    transparency, debuggability, and trust in AI-generated responses.
  </Card>

  <Card title="Computer Use" href="https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic#computer-use">
    (Experimental) Allow models to directly interact with computer desktop
    environments to complete complex, multi-step tasks autonomously.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="AI Chatbot">
    Craft intelligent, context-aware chatbots capable of nuanced conversations
    and sophisticated task completion. Experience this capability in our [Chat
    Demo](/ai/docs/chat).
  </Card>

  <Card title="Content Generation & Summarization">
    Generate high-quality text for various purposes, or summarize long documents
    and conversations accurately.
  </Card>

  <Card title="Data Extraction & Analysis">
    Extract structured information from unstructured text or analyze complex
    data sets combined with visual inputs for comprehensive insights.
  </Card>

  <Card title="Automated Workflows">
    Seamlessly integrate Claude models with your existing tools via function
    calling to automate complex business processes and tasks. Explore
    [Agents](/ai/docs/agents) for advanced implementation options.
  </Card>
</Cards>

## Links

* [Anthropic Website](https://www.anthropic.com)
* [Anthropic Documentation](https://docs.anthropic.com)
* [AI SDK - Anthropic Provider Docs](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic)
