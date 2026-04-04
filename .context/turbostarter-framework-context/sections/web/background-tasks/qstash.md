---
title: Upstash QStash
description: Integrate Upstash QStash with your TurboStarter application for serverless-first background task processing.
url: /docs/web/background-tasks/qstash
---

# Upstash QStash

[Upstash QStash](https://upstash.com/docs/qstash) is a serverless message queue and task scheduler designed specifically for serverless and edge environments. It uses HTTP endpoints instead of persistent connections, making it perfect for modern web applications.

<Callout title="Why QStash?">
  QStash is built for the serverless world - no infrastructure to manage, automatic scaling, and pay-per-use pricing. It delivers messages to your HTTP endpoints with built-in retries, delays, and scheduling capabilities.
</Callout>

<Steps>
  <Step>
    ## Setup

    Visit [Upstash Console](https://console.upstash.com) and create a free account. Create a new QStash project and note down your credentials.

    Add your QStash credentials to your root environment variables:

    ```dotenv title=".env.local"
    QSTASH_URL=https://qstash.upstash.io
    QSTASH_TOKEN=your_qstash_token_here
    QSTASH_CURRENT_SIGNING_KEY=your_current_signing_key_here
    QSTASH_NEXT_SIGNING_KEY=your_next_signing_key_here
    ```

    You can find these values in your Upstash Console under the QStash project settings.

    For production, make sure to add these environment variables to your deployment platform.
  </Step>

  <Step>
    ## Install dependencies

    Add the QStash SDK to your API package:

    ```bash
    pnpm add --filter api @upstash/qstash
    ```
  </Step>

  <Step>
    ## Create the QStash client

    Create a utility file to initialize the QStash client in your API package:

    ```ts title="packages/api/src/lib/qstash.ts"
    import { Client } from "@upstash/qstash";

    import { env } from "~/env";

    export const qstashClient = new Client({
      baseUrl: env.QSTASH_URL,
      token: env.QSTASH_TOKEN,
    });
    ```
  </Step>

  <Step>
    ## Create task handlers

    QStash delivers messages to HTTP endpoints, so you'll create API routes to handle your background tasks.

    Let's create task handlers for common operations:

    <Tabs items={["Task router", "Process user data", "Daily cleanup", "Verification middleware"]}>
      <Tab value="Task router">
        ```ts title="packages/api/src/modules/tasks/router.ts"
        import { Hono } from "hono";
        import * as z from "zod";

        import { qstashVerifyMiddleware } from "../../middleware/qstash-verify";
        import { dailyCleanupHandler } from "./handlers/daily-cleanup";
        import { processUserDataHandler } from "./handlers/process-user-data";

        const processUserDataSchema = z.object({
          userId: z.string(),
          operation: z.enum(["export", "analyze", "cleanup"]),
        });

        export const tasksRouter = new Hono()
          .basePath("/tasks")
          // Apply QStash signature verification to all task routes
          .use(qstashVerifyMiddleware)
          .post("/process-user-data", processUserDataHandler)
          .post("/daily-cleanup", dailyCleanupHandler);
        ```
      </Tab>

      <Tab value="Process user data">
        ```ts title="packages/api/src/modules/tasks/handlers/process-user-data.ts"
        import type { Context } from "hono";
        import * as z from "zod";

        const ProcessUserDataSchema = z.object({
          userId: z.string(),
          operation: z.enum(["export", "analyze", "cleanup"]),
        });

        export async function processUserDataHandler(c: Context) {
          try {
            const payload = ProcessUserDataSchema.parse(await c.req.json());
            const { userId, operation } = payload;

            console.log("Starting user data processing", { userId, operation });

            switch (operation) {
              case "export":
                // Simulate data export
                await new Promise((resolve) => setTimeout(resolve, 2000));
                console.log("User data exported successfully");
                return c.json({
                  success: true,
                  result: "Data exported to CSV",
                });

              case "analyze":
                // Simulate data analysis
                await new Promise((resolve) => setTimeout(resolve, 5000));
                console.log("User data analysis completed");
                return c.json({
                  success: true,
                  result: { totalActions: 156, avgSessionTime: "4m 32s" },
                });

              case "cleanup":
                // Simulate data cleanup
                await new Promise((resolve) => setTimeout(resolve, 3000));
                console.log("User data cleanup completed");
                return c.json({
                  success: true,
                  result: "Removed 23 obsolete records",
                });

              default:
                throw new Error(`Unknown operation: ${operation}`);
            }
          } catch (error) {
            console.error("Task failed:", error);
            return c.json({ error: "Task failed" }, 500);
          }
        }
        ```
      </Tab>

      <Tab value="Daily cleanup">
        ```ts title="packages/api/src/modules/tasks/handlers/daily-cleanup.ts"
        import type { Context } from "hono";

        export async function dailyCleanupHandler(c: Context) {
          try {
            console.log("Starting daily cleanup");

            // Cleanup old logs
            await new Promise((resolve) => setTimeout(resolve, 5000));
            console.log("Logs cleaned up");

            // Cleanup temporary files
            await new Promise((resolve) => setTimeout(resolve, 3000));
            console.log("Temp files cleaned up");

            // Generate daily reports
            await new Promise((resolve) => setTimeout(resolve, 8000));
            console.log("Reports generated");

            return c.json({
              success: true,
              cleanupTime: new Date().toISOString(),
              itemsProcessed: 1247,
            });
          } catch (error) {
            console.error("Daily cleanup failed:", error);
            return c.json({ error: "Daily cleanup failed" }, 500);
          }
        }
        ```
      </Tab>

      <Tab value="Verification middleware">
        ```ts title="packages/api/src/middleware/qstash-verify.ts"
        import { Receiver } from "@upstash/qstash";
        import { createMiddleware } from "hono/factory";

        export const qstashVerifyMiddleware = createMiddleware(async (c, next) => {
          const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
          const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

          if (!currentSigningKey || !nextSigningKey) {
            return c.json({ error: "QStash signing keys not configured" }, 500);
          }

          const signature = c.req.header("upstash-signature");

          if (!signature) {
            return c.json({ error: "Missing QStash signature" }, 401);
          }

          try {
            const body = await c.req.text();

            const receiver = new Receiver({
              currentSigningKey,
              nextSigningKey,
            });

            const isValid = receiver.verify({
              body,
              signature,
            });

            if (!isValid) {
              return c.json({ error: "Invalid QStash signature" }, 401);
            }

            // Re-create the request with the body for the next handler
            const newRequest = new Request(c.req.url, {
              method: c.req.method,
              headers: c.req.headers,
              body,
            });

            c.req = newRequest;
            await next();
          } catch (error) {
            console.error("QStash signature verification failed:", error);
            return c.json({ error: "Invalid signature" }, 401);
          }
        });
        ```
      </Tab>
    </Tabs>
  </Step>

  <Step>
    ## Register task routes

    Add the tasks router to your main API:

    ```ts title="packages/api/src/index.ts"
    import { tasksRouter } from "./modules/tasks/router";

    const appRouter = new Hono()
      .basePath("/api")
      .route("/tasks", tasksRouter)
      // ... other existing routers
      .onError(onError);

    export { appRouter };
    ```
  </Step>

  <Step>
    ## Triggering tasks

    You can trigger tasks from your TurboStarter application by publishing messages to QStash, which will then deliver them to your task endpoints.

    Create a service to handle task triggering:

    ```ts title="packages/api/src/modules/tasks/service.ts"
    import { qstashClient } from "../../lib/qstash";

    function getTaskUrl(taskName: string): string {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return `${baseUrl}/api/tasks/${taskName}`;
    }

    export class TaskService {
      static async processUserData(
        userId: string,
        operation: "export" | "analyze" | "cleanup",
      ) {
        return await qstashClient.publishJSON({
          url: getTaskUrl("process-user-data"),
          body: { userId, operation },
        });
      }

      static async scheduleUserDataProcessing(
        userId: string,
        operation: "export" | "analyze" | "cleanup",
        delaySeconds: number,
      ) {
        return await qstashClient.publishJSON({
          url: getTaskUrl("process-user-data"),
          body: { userId, operation },
          delay: `${delaySeconds}s`,
        });
      }

      static async scheduleDailyCleanup() {
        return await qstashClient.schedules.create({
          destination: getTaskUrl("daily-cleanup"),
          cron: "0 2 * * *", // Daily at 2 AM
        });
      }
    }
    ```
  </Step>

  <Step>
    ## Create API endpoints for triggering

    Create endpoints to trigger tasks from your application:

    ```ts title="packages/api/src/modules/tasks/trigger/router.ts"
    import { Hono } from "hono";
    import * as z from "zod";

    import { enforceAuth, validate } from "../../middleware";
    import { TaskService } from "./service";

    const triggerUserDataSchema = z.object({
      userId: z.string(),
      operation: z.enum(["export", "analyze", "cleanup"]),
      delaySeconds: z.number().optional(),
    });

    export const taskTriggerRouter = new Hono()
      .post(
        "/trigger/process-user-data",
        enforceAuth,
        validate("json", triggerUserDataSchema),
        async (c) => {
          const { userId, operation, delaySeconds } = c.req.valid("json");

          const result = delaySeconds
            ? await TaskService.scheduleUserDataProcessing(
                userId,
                operation,
                delaySeconds,
              )
            : await TaskService.processUserData(userId, operation);

          return c.json({
            success: true,
            messageId: result.messageId,
            message: delaySeconds
              ? `Task scheduled to run in ${delaySeconds} seconds`
              : "Task queued for immediate processing",
          });
        },
      )
      .post("/trigger/daily-cleanup", enforceAuth, async (c) => {
        const result = await TaskService.scheduleDailyCleanup();

        return c.json({
          success: true,
          scheduleId: result.scheduleId,
          message: "Daily cleanup scheduled",
        });
      });
    ```

    Add it to your main router:

    ```ts title="packages/api/src/index.ts"
    import { taskTriggerRouter } from "./modules/tasks/trigger/router";

    const appRouter = new Hono()
      .basePath("/api")
      .route("/tasks", tasksRouter)
      .route("/", taskTriggerRouter) // Trigger routes at root level
      // ... other existing routers
      .onError(onError);

    export { appRouter };
    ```
  </Step>

  <Step>
    ## Using tasks in your application

    ### From the client

    ```tsx title="apps/web/src/modules/tasks/process-data-button.tsx"
    "use client";

    import { handle } from "@turbostarter/api/utils";
    import { useMutation } from "@tanstack/react-query";

    import { api } from "~/lib/api/client";

    export function ProcessDataButton({ userId }: { userId: string }) {
      const { mutate: processData, isPending } = useMutation({
        mutationFn: handle(api.trigger["process-user-data"].$post),
        onSuccess: (data) => {
          console.log("Task queued:", data.messageId);
        },
      });

      return (
        <button
          onClick={() =>
            processData({
              json: {
                userId,
                operation: "analyze",
                delaySeconds: 30, // Optional delay
              },
            })
          }
          disabled={isPending}
        >
          {isPending ? "Queueing..." : "Analyze User Data"}
        </button>
      );
    }
    ```

    ### From a server action

    ```ts title="apps/web/src/app/actions/user-actions.ts"
    "use server";

    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/server";

    export async function processUserData(
      userId: string,
      operation: "export" | "analyze" | "cleanup",
    ) {
      try {
        const result = await handle(api.trigger["process-user-data"].$post)({
          json: { userId, operation },
        });

        return {
          success: true,
          messageId: result.messageId,
        };
      } catch (error) {
        console.error("Failed to queue background task:", error);
        throw new Error("Failed to queue background task");
      }
    }
    ```
  </Step>
</Steps>

## Advanced features

### Cron jobs & scheduling

QStash makes it easy to schedule recurring tasks:

```ts
// Schedule a task to run every day at 2 AM
await qstashClient.schedules.create({
  destination: `${baseUrl}/api/tasks/daily-cleanup`,
  cron: "0 2 * * *",
});

// Schedule a task to run every Monday at 9 AM
await qstashClient.schedules.create({
  destination: `${baseUrl}/api/tasks/weekly-report`,
  cron: "0 9 * * 1",
});

// One-time delayed task
await qstashClient.publishJSON({
  url: `${baseUrl}/api/tasks/reminder`,
  body: { userId: "123", type: "follow-up" },
  delay: "3d", // 3 days from now
});
```

### Topics (Fanout pattern)

Create topics to send messages to multiple endpoints:

```ts
// Create a topic
await qstashClient.topics.upsert({
  name: "user-events",
  endpoints: [
    { url: `${baseUrl}/api/tasks/update-analytics` },
    { url: `${baseUrl}/api/tasks/send-notification` },
    { url: `${baseUrl}/api/tasks/update-crm` },
  ],
});

// Publish to topic - all endpoints will receive the message
await qstashClient.publishJSON({
  topic: "user-events",
  body: {
    userId: "123",
    event: "user-registered",
    timestamp: new Date().toISOString(),
  },
});
```

### Queues (Sequential processing)

Create queues for ordered task processing:

```ts
// Create a queue
const queue = qstashClient.queue({ queueName: "user-onboarding" });

// Add tasks to queue (they'll run in order)
await queue.enqueueJSON({
  url: `${baseUrl}/api/tasks/send-welcome-email`,
  body: { userId: "123" },
});

await queue.enqueueJSON({
  url: `${baseUrl}/api/tasks/setup-user-profile`,
  body: { userId: "123" },
});

await queue.enqueueJSON({
  url: `${baseUrl}/api/tasks/trigger-onboarding-sequence`,
  body: { userId: "123" },
});
```

## Monitoring and debugging

### QStash Dashboard

Visit the [Upstash Console](https://console.upstash.com) to monitor your tasks:

* **Message tracking**: See all messages, their status, and delivery attempts
* **Logs**: View detailed logs for each message delivery
* **Analytics**: Monitor throughput, success rates, and error patterns
* **Schedules**: Manage and monitor your cron jobs
* **Dead letter queue**: Handle messages that failed after all retries

### Local development

During development, you can:

1. **Use ngrok** for local testing:

   ```bash
   # Install ngrok
   npm install -g ngrok

   # Expose your local server
   ngrok http 3000

   # Use the ngrok URL in your QStash configuration
   ```

2. **Check message delivery** in the Upstash Console

3. **Use console.log** in your task handlers for debugging

## Best practices

<Accordions>
  <Accordion title="Always verify signatures">
    Use the QStash signature verification middleware to ensure messages are authentic:

    ```ts
    // ✅ Good - Always verify QStash signatures
    .use(qstashVerifyMiddleware)

    // ❌ Not secure - Accepting unverified requests
    .post("/tasks/sensitive-operation", handler)
    ```
  </Accordion>

  <Accordion title="Handle errors gracefully">
    Return appropriate HTTP status codes so QStash knows whether to retry:

    ```ts
    // ✅ Good - Clear error handling
    try {
      await processTask(payload);
      return c.json({ success: true });
    } catch (error) {
      console.error("Task failed:", error);
      // 5xx = QStash will retry, 4xx = won't retry
      return c.json({ error: "Task failed" }, 500);
    }
    ```
  </Accordion>

  <Accordion title="Use idempotent operations">
    Make your tasks safe to run multiple times in case of retries:

    ```ts
    // ✅ Good - Check if work already done
    const existingResult = await db.findProcessedResult(payload.id);
    if (existingResult) {
      return c.json({ success: true, result: existingResult });
    }

    // Proceed with processing...
    ```
  </Accordion>

  <Accordion title="Set appropriate timeouts">
    Configure timeouts based on your expected processing time:

    ```ts
    // For quick tasks
    await qstashClient.publishJSON({
      url: taskUrl,
      body: payload,
      timeout: "30s",
    });

    // For longer tasks
    await qstashClient.publishJSON({
      url: taskUrl,
      body: payload,
      timeout: "300s", // 5 minutes
    });
    ```
  </Accordion>

  <Accordion title="Use structured logging">
    Include relevant context in your logs:

    ```ts
    console.log("Task started", {
      taskType: "process-user-data",
      userId: payload.userId,
      operation: payload.operation,
      timestamp: new Date().toISOString(),
    });
    ```
  </Accordion>
</Accordions>

## Next steps

With QStash integrated into your TurboStarter application, you can now:

* **Process background tasks** without worrying about serverless timeouts
* **Schedule recurring operations** with reliable cron job functionality
* **Handle high-volume messaging** with automatic retries and scaling
* **Build complex workflows** using topics, queues, and delays

Ready to explore more advanced features? Check out the official documentation for webhooks, batch operations, and advanced routing patterns.

<Cards>
  <Card title="Documentation" description="upstash.com" href="https://upstash.com/docs/qstash" />

  <Card title="Dashboard" description="console.upstash.com" href="https://console.upstash.com" />
</Cards>
