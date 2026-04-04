---
title: Chat with PDF
description: Engage in conversations with your PDF documents using AI to extract insights and answer questions.
url: /ai/docs/pdf
---

# Chat with PDF

The [Chat with PDF](https://ai.turbostarter.dev/pdf) demo application enables intelligent interaction with document content through a conversational AI interface. Upload PDF files and instantly engage in natural dialogue about their contents, asking questions, requesting summaries, and extracting key information with remarkable accuracy.

<AIAppShowcase id="pdf" />

## Features

Transform how you interact with document content through these powerful capabilities:

<Cards>
  <Card title="PDF upload">
    Easily upload PDF files directly into the application for analysis.
  </Card>

  <Card title="Contextual conversation">
    Chat with an AI that understands the content of your uploaded PDF, providing
    relevant answers based on the text.
  </Card>

  <Card title="Information extraction">
    Quickly find specific information, key points, or summaries within the
    document through natural language queries.
  </Card>

  <Card title="Source highlighting (coming soon)">
    Visualize exactly which document sections informed the AI's responses with
    precise source highlighting.
  </Card>

  <Card title="Multi-document intelligence (coming soon)">
    Conduct sophisticated conversations spanning multiple uploaded documents,
    enabling cross-document analysis and comparison.
  </Card>
</Cards>

## Setup

To implement the "Chat with PDF" application in your project, configure these essential backend services:

<Cards>
  <Card href="/ai/docs/database" title="Database">
    Set up PostgreSQL with the `pgvector` extension to efficiently store
    conversation history, document metadata, and vector embeddings for semantic
    search.
  </Card>

  <Card href="/ai/docs/storage" title="Storage">
    Configure S3-compatible cloud storage for secure management of uploaded PDF
    documents.
  </Card>
</Cards>

You'll also need to obtain API keys for both the conversational AI models and the embedding models used for text processing.

## AI models

This application leverages two complementary AI model types working together:

1. **Large Language Models (LLMs):** Provide sophisticated natural language understanding to interpret your questions and generate contextually appropriate responses based on document content.
2. **Embedding Models:** Convert document text segments into numerical vector representations that enable efficient semantic similarity search and [Retrieval-Augmented Generation (RAG)](https://en.wikipedia.org/wiki/Retrieval-augmented_generation).

Configure the providers for the models you wish to use:

<Cards>
  <Card href="/ai/docs/openai" title="OpenAI" description="Utilize GPT models for conversational AI and advanced embedding models for vector representation." icon={<OpenAI />} />

  <Card href="/ai/docs/anthropic" title="Anthropic" description="Implement Claude models for sophisticated reasoning and nuanced document understanding." icon={<Anthropic />} />

  <Card href="/ai/docs/google" title="Google AI" description="Leverage Gemini models for powerful conversational capabilities with document content." icon={<Google />} />

  <Card href="/ai/docs/replicate" title="Replicate" description="Access diverse open-source embedding models for flexible implementation options." icon={<Replicate />} />
</Cards>

For comprehensive configuration details, consult the [AI SDK documentation](https://sdk.vercel.ai/docs) covering provider setup and model selection.

## Data persistence

The application stores data related to chats, documents, and embeddings to provide a persistent experience.

<Card href="/ai/docs/database" title="Database" description="Learn more about database services in TurboStarter AI." />

Application data is organized within a dedicated PostgreSQL schema named `pdf`:

* `chats`: captures essential metadata for each document-specific conversation session.
* `messages`: stores all user queries and AI responses within conversation threads.
* `documents`: maintains comprehensive tracking of uploaded PDF files, including filenames and storage locations.
* `embeddings`: contains text segments extracted from PDFs along with their vector representations (using [`pgvector`](https://github.com/pgvector/pgvector)'s `vector` data type). To optimize similarity searches critical for RAG processing, the system creates an index (`embeddingIndex` using [HNSW](https://github.com/pgvector/pgvector#hnsw)) on the `embedding` column.

<Card href="/ai/docs/storage" title="Storage" description="Learn more about cloud storage services in TurboStarter AI." />

The PDF files uploaded by users are securely stored in your configured [cloud storage](/ai/docs/storage) bucket. The `path` field in the `documents` table maintains the precise reference to each file's location.

## Structure

The "Chat with PDF" feature is architected across the monorepo for optimal organization and code reuse:

### Core

The `@turbostarter/ai` package (`packages/ai`) contains the essential logic under `modules/pdf`:

* Comprehensive types, validation schemas, and constants specific to PDF processing
* Advanced document parsing, text segmentation, and embedding generation utilities
* Core API logic for managing conversations, performing RAG-based lookups, and interacting with LLMs
* Database operations for storing and retrieving conversations, documents, and embeddings
* Shared utilities for managing PDF file uploads and downloads

### API

The `packages/api` package defines the backend API endpoints using [Hono](https://hono.dev/):

* `src/modules/ai/pdf/pdf.router.ts`: implements Hono RPC routes for document upload and conversation management, handles input validation, applies middleware (authentication, credit management), and invokes the core functionality from `@turbostarter/ai`.

### Web

The [Next.js](https://nextjs.org/) application (`apps/web`) delivers an intuitive user interface:

* `src/app/[locale]/(apps)/pdf/**`: contains the Next.js App Router pages and layouts for the document conversation experience
* `src/components/pdf/**`: houses reusable React components specific to the PDF interaction UI (document upload, conversation interface, message display)

### Mobile

The [Expo](https://expo.dev/)/[React Native](https://reactnative.dev/) application (`apps/mobile`) provides a native mobile experience:

* `src/app/pdf/**`: defines the screens for the mobile document conversation interface
* `src/components/pdf/**`: contains React Native components optimized for mobile document interaction
* **API integration**: utilizes the same Hono RPC client (`packages/api`) as the web app for consistent backend communication

This architecture ensures that core AI processing and data handling logic is shared across platforms, while enabling optimized UI implementations tailored to each environment.
