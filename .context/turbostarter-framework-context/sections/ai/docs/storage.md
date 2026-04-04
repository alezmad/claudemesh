---
title: Storage
description: Explore cloud storage services for AI applications.
url: /ai/docs/storage
---

# Storage

Blob storage in TurboStarter AI offers a scalable solution for handling the diverse file types essential to modern AI applications. It works seamlessly with S3-compatible services including [AWS S3](https://aws.amazon.com/s3/), [Cloudflare R2](https://www.cloudflare.com/products/r2/), and [MinIO](https://min.io/).

## Use cases

Blob storage powers several key AI functions:

* **Managing user uploads:** safely storing files like PDFs or images that users upload for AI processing, as seen in the ["Chat with PDF" demo](/ai/docs/pdf) and image analysis features
* **Preserving AI-generated content:** storing outputs from AI models, such as images from the [Image Generation demo](/ai/docs/image) or audio files from the [Text-to-Speech demo](/ai/docs/tts)
* **Powering RAG systems:** housing documents and files that serve as knowledge sources for Retrieval-Augmented Generation, used in demos like [Chat with PDF](/ai/docs/pdf) and intelligent [Agents](/ai/docs/agents)

## Security

Properly configuring bucket permissions for your storage provider is critical. Always restrict access based on the principle of least privilege:

* Buckets containing user uploads or sensitive RAG documents should typically **not** be publicly accessible
* Set precise permissions that allow your application server (API) to read/write as needed while blocking unauthorized access

Refer to your provider's documentation ([AWS S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html), [Cloudflare R2](https://developers.cloudflare.com/security-center/security-insights/roles-and-permissions/), [MinIO](https://min.io/docs/minio/linux/administration/identity-access-management/policy-based-access-control.html)) for specific guidance on securing your storage buckets.

## Storage documentation

For detailed setup instructions, configuration options for different storage providers, and implementation best practices, check out the core storage documentation:

<Card title="Storage documentation" href="/docs/web/storage/overview" description="Learn how to configure and manage blob storage providers in the core TurboStarter documentation." />

In summary, blob storage is essential for building sophisticated AI applications - enabling you to handle user uploads, store AI-generated files, and manage RAG document collections.
