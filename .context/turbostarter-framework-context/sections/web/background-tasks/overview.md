---
title: Overview
description: Learn about background tasks & cron jobs and how they can power your application.
url: /docs/web/background-tasks/overview
---

# Overview

Background tasks and cron jobs are long-running processes that execute outside of your main application flow, allowing you to handle time-intensive operations and scheduled workflows without blocking user interactions or hitting serverless function timeouts.

<Callout title="Perfect for time-intensive & scheduled operations">
  Background tasks are ideal for operations that take longer than typical serverless function timeouts (10-60 seconds), such as processing large files, sending batch emails, or making multiple API calls.

  Cron jobs are perfect for recurring operations like daily reports, cleanup tasks, or periodic data synchronization.
</Callout>

## What are background tasks?

**Background tasks** are asynchronous processes that run separately from your main application thread. Instead of forcing users to wait for lengthy operations to complete, you can offload these tasks to run in the background while your application remains responsive.

**Cron jobs** are scheduled background tasks that run automatically at specific times or intervals. They're perfect for maintenance operations, reports, and recurring workflows that need to happen without user intervention.

Think of background tasks as your application's *worker threads* - they handle the heavy lifting while your main application stays fast and responsive for users.

<ThemedImage alt="Background tasks architecture diagram" light="/images/docs/web/background-tasks/light.png" dark="/images/docs/web/background-tasks/dark.png" width={1335} height={285} zoomable />

## Why use background tasks?

<Cards className="grid-cols-1">
  <Card title="Avoid timeouts">
    Most serverless platforms have strict execution limits:

    * **[Vercel (Hobby)](https://vercel.com/docs/functions/serverless-functions/runtimes#max-duration)**: 300 seconds
    * **[Vercel (Pro)](https://vercel.com/docs/functions/serverless-functions/runtimes#max-duration)**: 800 seconds
    * **[Vercel (Enterprise)](https://vercel.com/docs/functions/serverless-functions/runtimes#max-duration)**: 800 seconds
    * **[AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)**: 900 seconds
    * **[Netlify Functions](https://docs.netlify.com/functions/overview/#default-deployment-options)**: 30 seconds

    Background tasks let you bypass these limitations entirely.
  </Card>

  <Card title="Better user experience">
    Users don't have to wait for long-running processes. They can continue using
    your application while tasks complete in the background.
  </Card>

  <Card title="Automated workflows">
    Cron jobs enable hands-off automation of recurring tasks like daily backups,
    weekly reports, or monthly user engagement analysis - all running reliably
    without manual intervention.
  </Card>

  <Card title="Improved reliability">
    Background tasks can be automatically retried if they fail, ensuring your
    critical processes eventually complete successfully.
  </Card>

  <Card title="Resource optimization">
    Your main application servers stay available to handle user requests instead of being tied up with heavy processing tasks.
  </Card>
</Cards>

## Common use cases

Here are some typical scenarios where background tasks shine:

<Accordions>
  <Accordion title="File processing">
    * **Video transcoding**: Converting uploaded videos to different formats or resolutions
    * **Image optimization**: Batch processing user-uploaded images
    * **Document parsing**: Extracting text from PDFs or generating thumbnails
  </Accordion>

  <Accordion title="Data operations">
    * **Database migrations**: Moving or transforming large datasets
    * **Report generation**: Creating complex analytics reports
    * **Data synchronization**: Syncing data between different systems
  </Accordion>

  <Accordion title="Communication">
    * **Email campaigns**: Sending personalized emails to large user lists
    * **Notification processing**: Delivering push notifications across multiple platforms
    * **SMS campaigns**: Bulk SMS sending with rate limiting
  </Accordion>

  <Accordion title="AI and ML tasks">
    * **Content generation**: Using AI models to generate text, images, or videos
    * **Data analysis**: Running machine learning models on large datasets
    * **Natural language processing**: Analyzing text content for insights
  </Accordion>

  <Accordion title="Third-party integrations">
    * **API synchronization**: Syncing data with external services
    * **Webhook processing**: Handling incoming webhooks that trigger complex workflows
    * **Social media automation**: Posting content across multiple platforms
  </Accordion>

  <Accordion title="Scheduled operations (Cron jobs)">
    * **Daily reports**: Generating and emailing daily analytics or performance reports
    * **Database maintenance**: Cleaning up old records, optimizing indexes, or running backups
    * **User engagement**: Sending weekly newsletters or monthly account summaries
    * **System monitoring**: Health checks, performance monitoring, and alert notifications
    * **Content management**: Auto-publishing scheduled content or archiving old posts
  </Accordion>
</Accordions>

## When not to use background tasks?

Background tasks and cron jobs aren't always the right solution. Consider alternatives for:

* **Real-time operations**: Tasks that users need immediate results from
* **Simple, fast operations**: Tasks that complete in under 5-10 seconds
* **Database queries**: Standard CRUD operations that should remain synchronous
* **User authentication**: Login/logout processes should be immediate

<Callout type="warn" title="Keep it simple">
  Start with synchronous processing for simple tasks and manual processes for infrequent operations. Only move to background tasks when you hit timeout limitations or user experience issues, and only use cron jobs when you need reliable automation.
</Callout>

## Getting started

Ready to add background tasks to your TurboStarter application? Check out our [Trigger.dev integration guide](/docs/web/background-tasks/trigger) or [Upstash QStash integration guide](/docs/web/background-tasks/qstash) to learn how to implement background tasks using one of the most developer-friendly background job frameworks available.
