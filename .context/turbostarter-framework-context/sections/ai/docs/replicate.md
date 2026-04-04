---
title: Replicate
description: Setup Replicate provider and learn how to use it in the starter kit.
url: /ai/docs/replicate
---

# Replicate

The [Replicate](https://replicate.com) provider unlocks access to an extensive library of open-source AI models through a streamlined cloud API, seamlessly integrated with the AI SDK. It's particularly well-known for image generation capabilities.

![Replicate](/images/docs/ai/providers/replicate.png)

## Setup

<Steps>
  <Step>
    ### Generate API Key

    Visit the [Replicate website](https://replicate.com/), create an account or sign in, then navigate to your account settings to generate your personal API token.
  </Step>

  <Step>
    ### Add API Key to Environment

    Add your API token to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    REPLICATE_API_TOKEN=your-api-key
    ```
  </Step>

  <Step>
    ### Configure Provider (Optional)

    The starter kit automatically uses the `REPLICATE_API_TOKEN` environment variable. For advanced configurations (such as proxies or custom headers), you can create a tailored provider instance. For comprehensive details, refer to the [AI SDK Replicate documentation](https://sdk.vercel.ai/providers/ai-sdk-providers/replicate#provider-instance).
  </Step>
</Steps>

## Features

<Cards>
  <Card title="Run Open-Source Models" href="https://replicate.com/explore">
    Gain instant access to a diverse ecosystem of community-contributed models
    spanning text generation, image creation, audio processing, video synthesis,
    and numerous other AI capabilities.
  </Card>

  <Card title="Image Generation" href="https://sdk.vercel.ai/providers/ai-sdk-providers/replicate#image-models">
    Create stunning visuals using various state-of-the-art open-source models
    directly through the AI SDK's intuitive `generateImage` function, with
    support for specific model versions and custom parameters.
  </Card>

  <Card title="Model-Specific Options" href="https://sdk.vercel.ai/providers/ai-sdk-providers/replicate#model-specific-options">
    Fine-tune model behavior by passing specific parameters via
    `providerOptions.replicate`, allowing precise control over generation
    settings according to each model's unique capabilities.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="Image Generation">
    Create unique visuals, artwork, or variations based on text prompts using a
    diverse set of image models. Check out the [Image Generation
    Demo](/ai/docs/image).
  </Card>

  <Card title="Access Niche Models">
    Utilize specialized open-source models for specific tasks that might not be
    available through other major providers.
  </Card>

  <Card title="AI Experimentation">
    Quickly experiment with different community-published models for various AI
    tasks without managing infrastructure.
  </Card>
</Cards>

## Links

* [Replicate Website](https://replicate.com)
* [Replicate Documentation](https://replicate.com/docs)
* [AI SDK - Replicate Provider Docs](https://sdk.vercel.ai/providers/ai-sdk-providers/replicate)
