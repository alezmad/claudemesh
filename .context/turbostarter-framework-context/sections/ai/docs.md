---
title: Get started
description: An overview of the TurboStarter AI starter kit.
url: /ai/docs
---

# Get started

TurboStarter AI is a **starter kit with ready-to-use demo apps** that helps you quickly build powerful AI applications without starting from scratch. Whether you're launching a small side project or a full-scale enterprise solution, it provides the structure you need to jump right into building your own unique AI application.

<AppsShowcase className="pt-2 [&_a]:no-underline [&_img]:my-0" />

## Features

TurboStarter AI comes packed with features designed to accelerate your development process:

### Core framework

<Cards>
  <Card title="Monorepo setup" description="Powered by Turborepo for efficient code sharing and dependency management across web and mobile applications." className="shadow-none" />

  <Card title="Next.js web app" description="Leverages Next.js for server-side rendering, static site generation, and API routes." className="shadow-none" />

  <Card title="Hono API" description="Ultra-fast API framework optimized for edge computing with comprehensive TypeScript support." className="shadow-none" />

  <Card title="React Native + Expo" description="Foundation for cross-platform mobile apps that share business logic with your web application." className="shadow-none" />
</Cards>

### AI

<Cards>
  <Card title="Vercel AI SDK" description="Complete toolkit for implementing advanced AI features like streaming responses and interactive chat interfaces." className="shadow-none" />

  <Card title="LangChain" description="Powerful framework for building sophisticated AI applications with prompt management, memory systems, and agent capabilities." className="shadow-none" />

  <Card title="Multiple AI providers" description="Seamless integration with OpenAI, Anthropic, Google AI, xAI, Meta, Deepseek, Replicate, Eleven Labs, and more through a unified interface." className="shadow-none" />

  <Card title="Specialized models" description="Full support for text generation, structured output, image creation, voice synthesis, and embedding models." className="shadow-none" />

  <Card title="One-line model switching" description="Effortlessly switch between AI models or providers with minimal code changes." className="shadow-none" />
</Cards>

### Data storage

<Cards>
  <Card title="Drizzle ORM" description="Type-safe ORM for efficient interaction with PostgreSQL (default) or other supported databases (MySQL, SQLite)." className="shadow-none" />

  <Card title="PostgreSQL database" description="Reliable storage for chat history, user data, and vector embeddings with optimized performance." className="shadow-none" />

  <Card title="Vector embeddings" description="Built-in support for storing and retrieving vector embeddings for advanced retrieval-augmented generation." className="shadow-none" />

  <Card title="Blob storage" description="Integrated S3-compatible storage for managing user uploads, AI-generated content, and documents." className="shadow-none" />
</Cards>

### Authentication

<Cards>
  <Card title="Better Auth integration" description="Secure authentication system starting with anonymous sessions, extensible to email/password, magic links, and OAuth providers." className="shadow-none" />

  <Card title="Rate limiting" description="Intelligent protection for API endpoints against abuse and overuse." className="shadow-none" />

  <Card title="Credits-based access" description="Flexible system to manage and control AI feature usage with customizable credit allocation." className="shadow-none" />

  <Card title="Backend API key management" description="Security-first approach ensuring sensitive API keys remain protected on the server side." className="shadow-none" />
</Cards>

### User interface

<Cards>
  <Card title="Tailwind CSS & shadcn/ui" description="Utility-first CSS framework and pre-designed components for rapid UI development." className="shadow-none" />

  <Card title="Radix UI" description="Accessible, unstyled components that provide the foundation for beautiful, functional interfaces." className="shadow-none" />

  <Card title="Shared UI package" description="Centralized UI component library ensuring consistency across all applications in the monorepo." className="shadow-none" />
</Cards>

## Demo apps

TurboStarter AI includes several production-ready demo applications that showcase diverse AI capabilities. Use these examples to understand implementation patterns and jumpstart your own projects.

<Cards>
  <Card title="Chatbot" description="Build intelligent conversational experiences with an AI chatbot featuring contextual reasoning and real-time web search capabilities." href="/ai/docs/chat" icon={<Chatting01Icon />} />

  <Card title="Image generation" description="Create compelling visuals with a versatile AI image generator supporting multiple models, styles, and output resolutions." href="/ai/docs/image" icon={<Image02Icon />} />

  <Card title="Chat with PDF" description="Extract valuable insights from documents by having natural conversations with your PDFs using context-aware AI." href="/ai/docs/pdf" icon={<File01Icon />} />

  <Card title="Text to speech" description="Convert written content into lifelike speech with support for over 5,000+ voices across multiple languages and styles." href="/ai/docs/tts" icon={<AudioWaves />} />

  <Card title="Agents" description="Develop autonomous AI agents capable of executing complex tasks by orchestrating multiple AI models and tools." href="/ai/docs/agents" icon={<WorkflowCircle01Icon />} />
</Cards>

## Scope of this documentation

This documentation focuses specifically on the AI features, architecture, and demo applications included in the **TurboStarter AI** kit. While we provide comprehensive coverage of AI integrations, for information about core framework elements (authentication, billing, etc.), please refer to the [Core documentation](/docs/web).

Our goal is to guide you through setting up, customizing, and deploying the AI starter kit efficiently. Where relevant, we include links to official documentation for the integrated AI providers and libraries.

## Setup

Getting started with TurboStarter AI requires configuring the core applications first. For detailed setup instructions, refer to:

<Cards>
  <Card title="Web app setup" description="Follow our step-by-step guide in the Core web documentation to set up your web application." href="/docs/web/installation/development" icon={<Website />} />

  <Card title="Mobile app setup" description="Use our detailed guide in the Core mobile documentation to configure your mobile application." href="/docs/mobile/installation/development" icon={<Phone />} />
</Cards>

After establishing the core applications, you can configure specific AI providers and demo applications using the dedicated sections in this documentation (see sidebar). For a quick start, you might also want to check our [TurboStarter CLI guide](/blog/the-only-turbo-cli-you-need-to-start-your-next-project-in-seconds) to bootstrap your project in seconds.

<Callout>
  When working with the AI starter kit, remember to use the `ai` repository instead of `core` for Git commands. For example, use `git clone turbostarter/ai` rather than `git clone turbostarter/core`.
</Callout>

## Deployment

Deploying TurboStarter AI follows the same process as deploying the core web application. Ensure you configure all necessary environment variables, including those for your selected AI providers (like [OpenAI](/ai/docs/openai), [Anthropic](/ai/docs/anthropic), etc.), in your deployment environment.

For comprehensive deployment instructions across various platforms, consult our core deployment guides:

<Cards>
  <Card title="Deployment checklist" description="General checklist before deploying the web app." href="/docs/web/deployment/checklist" />

  <Card title="Vercel" description="Streamlined deployment process for Vercel hosting." href="/docs/web/deployment/vercel" />

  <Card title="Railway" description="Step-by-step guide for deploying to Railway." href="/docs/web/deployment/railway" />

  <Card title="Docker" description="Container-based deployment using Docker." href="/docs/web/deployment/docker" />

  <Card title="Other Providers" description="Additional guides for Netlify, Render, AWS Amplify, Fly.io and more." href="/docs/web/deployment/checklist" />
</Cards>

For mobile app store deployment, refer to our mobile publishing guides:

<Cards>
  <Card title="Publishing checklist" description="Comprehensive pre-publishing verification for mobile applications." href="/docs/mobile/publishing/checklist" />

  <Card title="Updates" description="Best practices for managing updates to published mobile apps." href="/docs/mobile/publishing/updates" />
</Cards>

Each AI demo app may have specific deployment considerations, so check their dedicated documentation sections for additional guidance.

## `llms.txt`

Access the complete TurboStarter documentation in Markdown format at [/llms.txt](/llms.txt). This file contains all documentation in an LLM-friendly format, enabling you to ask questions about TurboStarter using the most current information.

### Example usage

To query an LLM about TurboStarter:

1. Copy the documentation contents from [/llms.txt](/llms.txt)
2. Use this prompt format with your preferred LLM:

```
Documentation:
{paste documentation here}

---

Based on the above documentation, answer the following:
{your question}
```

## Let's build amazing AI!

We're excited to help you create innovative AI-powered applications quickly and efficiently. If you have questions, encounter issues, or want to showcase your creations, connect with our community:

* [Follow updates on X](https://x.com/turbostarter_)
* [Join our Discord](https://discord.gg/KjpK2uk3JP)
* [Report issues on GitHub](https://github.com/turbostarter)
* [Contact us via email](mailto:hello@turbostarter.dev)

Happy building! 🚀
