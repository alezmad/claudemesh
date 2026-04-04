---
title: Google AI
description: Setup Google Generative AI provider and learn how to use its models like Gemini in the starter kit.
url: /ai/docs/google
---

# Google AI

The [Google Generative AI](https://ai.google/) provider integrates Google's state-of-the-art models, including the versatile Gemini family, into your applications through the AI SDK.

![Google Generative AI](/images/docs/ai/providers/google.webp)

## Setup

<Steps>
  <Step>
    ### Generate API Key

    Visit the [Google AI Studio](https://aistudio.google.com/app/apikey) to create your API key. For enterprise applications using Google Cloud, you can alternatively configure authentication via Application Default Credentials or service accounts.
  </Step>

  <Step>
    ### Add API Key to Environment

    Add your API key to your project's `.env` file (e.g., in `apps/web`):

    ```bash title=".env"
    GOOGLE_GENERATIVE_AI_API_KEY=your-api-key
    ```

    If using Google Cloud credentials instead, ensure they're properly configured in your environment.
  </Step>

  <Step>
    ### Configure Provider (Optional)

    The starter kit automatically uses the `GOOGLE_GENERATIVE_AI_API_KEY` environment variable. For advanced configurations (such as proxies, custom API versions, or specific headers), you can create a tailored provider instance using `createGoogleGenerativeAI`. See the [AI SDK Google documentation](https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#provider-instance) for comprehensive details.
  </Step>
</Steps>

## Features

<Cards>
  <Card title="Language Models (Gemini)" href="https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#language-models">
    Leverage Google's advanced Gemini models for chat, text generation,
    reasoning, and complex instruction following.
  </Card>

  <Card title="Embedding Models" href="https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#embedding-models">
    Utilize text embedding models to convert text into numerical representations
    for tasks like semantic search, clustering, and RAG.
  </Card>

  <Card title="Vision / File Input" href="https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#file-inputs">
    Analyze and understand various file types (including images and PDFs)
    alongside text prompts, enabling rich multimodal applications with
    comprehensive content understanding.
  </Card>

  <Card title="Tool Usage / Function Calling" href="https://sdk.vercel.ai/docs/concepts/tools">
    Empower models to interact seamlessly with external tools and APIs, allowing
    them to perform real-world actions and retrieve up-to-date information for
    more capable applications.
  </Card>

  <Card title="Safety Settings" href="https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#safety-ratings">
    Configure safety thresholds to control model responses regarding harmful
    content categories. Access safety ratings in the response metadata.
  </Card>

  <Card title="Cached Content" href="https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#cached-content">
    Cache content to optimize context reuse and potentially reduce latency and
    costs for repeated queries with similar context.
  </Card>

  <Card title="Search Grounding" href="https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai#search-grounding">
    (With compatible models) Ground responses in real-time search results,
    dramatically enhancing factual accuracy and providing up-to-date information
    on current topics.
  </Card>
</Cards>

## Use Cases

<Cards>
  <Card title="AI Chatbot">
    Create sophisticated conversational agents powered by Gemini models that can
    engage in natural dialogue and handle complex, multi-step tasks. Experience
    this in our [Chat Demo](/ai/docs/chat).
  </Card>

  <Card title="Content Generation">
    Generate diverse text formats, from creative writing and marketing copy to
    code explanations and summaries.
  </Card>

  <Card title="Multimodal Applications">
    Build applications that seamlessly analyze and understand images, documents,
    and other file types alongside text, creating richer, more contextual user
    experiences.
  </Card>

  <Card title="Semantic Search & RAG">
    Implement powerful search capabilities or sophisticated Retrieval-Augmented
    Generation systems using Google's high-performance embedding models for more
    accurate information retrieval.
  </Card>

  <Card title="Automated Workflows">
    Streamline operations by connecting language models to external tools and
    APIs through function calling, automating complex business processes and
    repetitive tasks with minimal human intervention.
  </Card>
</Cards>

## Links

* [Google AI](https://ai.google/)
* [Google AI Studio](https://aistudio.google.com/)
* [Google Generative AI Documentation](https://ai.google.dev/docs)
* [AI SDK - Google Provider Docs](https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai)
