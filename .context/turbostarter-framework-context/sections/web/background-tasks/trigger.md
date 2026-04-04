---
title: trigger.dev
description: Integrate trigger.dev with your TurboStarter application for reliable background task processing.
url: /docs/web/background-tasks/trigger
---

# trigger.dev

[trigger.dev](https://trigger.dev) is an open-source background jobs framework that lets you write reliable workflows in plain async code.

<Callout title="Why trigger.dev?">
  trigger.dev provides automatic retries, real-time monitoring, and seamless scaling - all while letting you write background tasks in familiar JavaScript/TypeScript code directly in your TurboStarter project.
</Callout>

<Steps>
  <Step>
    ## Setup

    Visit [trigger.dev](https://trigger.dev) and create a free account. Create a new project and note down your API key.

    Add your trigger.dev API key to your root environment variables:

    ```dotenv title=".env.local"
    TRIGGER_SECRET_KEY=your_secret_key_here
    ```

    For production, make sure to add the production API key to your deployment environment.
  </Step>

  <Step>
    ## Create a new package in your repository

    You can use the [Turbo generator](/docs/web/customization/add-package) to quickly scaffold the package structure:

    ```bash
    turbo gen package
    ```

    When prompted, name your package `tasks`. This will create the basic structure for you.

    Alternatively, create a new folder `tasks` in the `/packages` directory and add the following files:

    <Tabs items={["package.json", "tsconfig.json", "trigger.config.ts"]}>
      <Tab value="package.json">
        ```json
        {
          "name": "@turbostarter/tasks",
          "private": true,
          "version": "0.1.0",
          "type": "module",
          "exports": {
            ".": "./src/index.ts"
          },
          "scripts": {
            "clean": "git clean -xdf .cache .turbo dist node_modules",
            "dev": "pnpm dlx trigger.dev@latest dev",
            "deploy": "pnpm dlx trigger.dev@latest deploy",
            "format": "prettier --check . --ignore-path ../../.gitignore",
            "lint": "eslint",
            "typecheck": "tsc --noEmit"
          },
          "dependencies": {
            "@trigger.dev/sdk": "3.3.17"
          },
          "devDependencies": {
            "@trigger.dev/build": "3.3.17",
            "@turbostarter/eslint-config": "workspace:*",
            "@turbostarter/prettier-config": "workspace:*",
            "@turbostarter/tsconfig": "workspace:*",
            "eslint": "catalog:",
            "prettier": "catalog:",
            "typescript": "catalog:"
          },
          "prettier": "@turbostarter/prettier-config"
        }
        ```
      </Tab>

      <Tab value="tsconfig.json">
        ```json
        {
          "extends": "@turbostarter/tsconfig/base.json",
          "include": ["**/*.ts"],
          "exclude": ["dist", "build", "node_modules"]
        }
        ```
      </Tab>

      <Tab value="trigger.config.ts">
        ```ts
        import { defineConfig } from "@trigger.dev/sdk";

        export default defineConfig({
          project: "your_project_id", // Replace with your actual project ID
          runtime: "node",
          logLevel: "log",
          maxDuration: 300,
          dirs: ["./src/trigger"],
        });
        ```
      </Tab>
    </Tabs>
  </Step>

  <Step>
    ## Create your first task

    Now create your first task in the `packages/tasks/src/trigger` directory:

    <Tabs items={["process-user-data.ts", "daily-cleanup.ts", "src/index.ts"]}>
      <Tab value="process-user-data.ts">
        ```ts title="packages/tasks/src/trigger/process-user-data.ts"
        import { task, logger, wait } from "@trigger.dev/sdk";
        import * as z from "zod";

        const ProcessUserDataSchema = z.object({
          userId: z.string(),
          operation: z.enum(["export", "analyze", "cleanup"]),
        });

        export const processUserDataTask = task({
          id: "process-user-data",
          run: async (payload: z.infer<typeof ProcessUserDataSchema>) => {
            const { userId, operation } = payload;

            logger.info("Starting user data processing", { userId, operation });

            switch (operation) {
              case "export":
                await wait.for({ seconds: 2 });
                logger.info("User data exported successfully");
                return { success: true, result: "Data exported to CSV" };

              case "analyze":
                await wait.for({ seconds: 5 });
                logger.info("User data analysis completed");
                return {
                  success: true,
                  result: { totalActions: 156, avgSessionTime: "4m 32s" },
                };

              case "cleanup":
                await wait.for({ seconds: 3 });
                logger.info("User data cleanup completed");
                return { success: true, result: "Removed 23 obsolete records" };

              default:
                throw new Error(`Unknown operation: ${operation}`);
            }
          },
        });
        ```
      </Tab>

      <Tab value="daily-cleanup.ts">
        ```ts title="packages/tasks/src/trigger/daily-cleanup.ts"
        import { schedules, task, logger, wait } from "@trigger.dev/sdk";

        export const dailyCleanupTask = task({
          id: "daily-cleanup",
          run: async () => {
            logger.info("Starting daily cleanup");

            // Cleanup old logs
            await wait.for({ seconds: 5 });
            logger.info("Logs cleaned up");

            // Cleanup temporary files
            await wait.for({ seconds: 3 });
            logger.info("Temp files cleaned up");

            // Generate daily reports
            await wait.for({ seconds: 8 });
            logger.info("Reports generated");

            return {
              success: true,
              cleanupTime: new Date().toISOString(),
              itemsProcessed: 1247,
            };
          },
        });

        // Schedule the task to run daily at 2 AM
        schedules.create({
          task: "daily-cleanup",
          cron: "0 2 * * *",
        });
        ```
      </Tab>

      <Tab value="src/index.ts">
        ```ts title="packages/tasks/src/index.ts"
        export * from "./trigger/process-user-data";
        export * from "./trigger/daily-cleanup";
        ```
      </Tab>
    </Tabs>
  </Step>

  <Step>
    ## Test your task

    You can test your tasks locally by running:

    ```bash
    # Start the development server
    pnpm --filter @turbostarter/tasks dev
    ```

    This will deploy your tasks to trigger.dev in the development environment, allowing you to trigger them from the dashboard or programmatically.
  </Step>

  <Step>
    ## Deploy your tasks

    To deploy your tasks to production on trigger.dev, run:

    ```bash
    pnpm --filter @turbostarter/tasks deploy
    ```

    You can also add this command as an automated deployment step in your CI/CD pipeline by creating a new GitHub action.

    Add the `TRIGGER_ACCESS_TOKEN` secret to your repository secrets, which you can create in the trigger.dev dashboard.

    ```yml title=".github/workflows/deploy-tasks.yml"
    name: Deploy to trigger.dev (prod)

    on:
      push:
        branches:
          - main

    jobs:
      deploy:
        runs-on: ubuntu-latest

        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with:
              node-version: lts/*
          - uses: pnpm/action-setup@v4
          - name: Install dependencies
            run: pnpm install
          - name: Deploy trigger tasks
            env:
              TRIGGER_ACCESS_TOKEN: ${{ secrets.TRIGGER_ACCESS_TOKEN }}
            run: |
              pnpm --filter @turbostarter/tasks deploy
    ```
  </Step>

  <Step>
    ## Triggering tasks

    You can trigger tasks from your TurboStarter application using the API layer.

    <Callout type="warning" title="Direct task triggering not recommended">
      While you can trigger tasks directly from your frontend or server components using the trigger.dev SDK, it's recommended to use the API layer approach shown below.

      This provides better security, validation, and separation of concerns.
    </Callout>

    First, add the `@turbostarter/tasks` package as a dependency to your API package:

    ```json title="packages/api/package.json"
    {
      "dependencies": {
        "@turbostarter/tasks": "workspace:*"
      }
    }
    ```

    ### From an API endpoint

    Create a new API module to handle task triggering:

    ```ts title="packages/api/src/modules/tasks/tasks.router.ts"
    import { tasks } from "@trigger.dev/sdk";
    import { Hono } from "hono";
    import * as z from "zod";
    import type { processUserDataTask } from "@turbostarter/tasks";

    import { enforceAuth, validate } from "../../middleware";

    const processUserDataSchema = z.object({
      userId: z.string(),
      operation: z.enum(["export", "analyze", "cleanup"]),
    });

    export const tasksRouter = new Hono().post(
      "/process-user-data",
      enforceAuth,
      validate("json", processUserDataSchema),
      async (c) => {
        const { userId, operation } = c.req.valid("json");

        const handle = await tasks.trigger<typeof processUserDataTask>(
          "process-user-data",
          { userId, operation },
        );

        return c.json({
          success: true,
          taskId: handle.id,
          message: "Background task started successfully",
        });
      },
    );
    ```

    Then register it in your main API router:

    ```ts title="packages/api/src/index.ts"
    import { tasksRouter } from "./modules/tasks/tasks.router";

    const appRouter = new Hono()
      .basePath("/api")
      .route("/tasks", tasksRouter)
      // ... other existing routers
      .onError(onError);

    export { appRouter };
    ```

    ### From the client

    You can call the task endpoint from your web app using TurboStarter's API client:

    ```tsx title="apps/web/src/modules/tasks/process-data-button.tsx"
    "use client";

    import { handle } from "@turbostarter/api/utils";
    import { useMutation } from "@tanstack/react-query";

    import { api } from "~/lib/api/client";

    export function ProcessDataButton({ userId }: { userId: string }) {
      const { mutate: processData, isPending } = useMutation({
        mutationFn: handle(api.tasks["process-user-data"].$post),
        onSuccess: (data) => {
          console.log("Task started:", data.taskId);
        },
      });

      return (
        <button
          onClick={() =>
            processData({
              json: { userId, operation: "analyze" },
            })
          }
          disabled={isPending}
        >
          {isPending ? "Processing..." : "Analyze User Data"}
        </button>
      );
    }
    ```

    ### From a server action

    ```ts title="apps/web/src/app/actions/user-actions.ts"
    "use server";

    import { handle } from "@turbostarter/api/utils";

    import { api } from "~/lib/api/server";

    export async function processUserData(userId: string, operation: string) {
      try {
        const result = await handle(api.tasks["process-user-data"].$post)({
          json: { userId, operation },
        });

        return {
          success: true,
          taskId: result.taskId,
        };
      } catch (error) {
        console.error("Failed to trigger background task:", error);
        throw new Error("Failed to start background task");
      }
    }
    ```
  </Step>
</Steps>

## Monitoring and debugging

### Dashboard access

Visit the [trigger.dev dashboard](https://trigger.dev) to monitor your tasks:

* View task execution logs and performance metrics
* Track success and failure rates across all your tasks
* Monitor task duration and resource usage
* Replay failed tasks with a single click
* Set up alerts for task failures or performance issues

### Local development

During development, run your tasks locally while connected to trigger.dev:

```bash
# Start everything in the workspace
pnpm dev

# or start the tasks package only
pnpm --filter @turbostarter/tasks dev
```

This allows you to:

* Test tasks locally with real data
* Debug with breakpoints and console logs
* See immediate feedback as you develop

## Best practices

<Accordions>
  <Accordion title="Use descriptive task IDs">
    ```ts
    // ✅ Good - Clear and descriptive
    id: "user-data-export-csv";
    id: "weekly-newsletter-campaign";
    id: "cleanup-temp-files";

    // ❌ Not so good - Generic and unclear
    id: "task1";
    id: "job";
    id: "process";
    ```
  </Accordion>

  <Accordion title="Include proper error handling">
    ```ts
    run: async (payload) => {
      try {
        const result = await processData(payload);
        logger.info("Task completed successfully", { result });
        return result;
      } catch (error) {
        logger.error("Task failed:", error.message);
        throw error; // Re-throw to trigger retry logic
      }
    },
    ```
  </Accordion>

  <Accordion title="Use structured logging">
    ```ts
    logger.info("Processing started", {
      userId: payload.userId,
      operation: payload.operation,
      timestamp: new Date().toISOString(),
    });
    ```
  </Accordion>

  <Accordion title="Keep tasks focused">
    Instead of one massive task, create focused, single-purpose tasks that can be composed together for complex workflows.
  </Accordion>

  <Accordion title="Configure appropriate retries">
    Set retry policies based on your task's requirements:

    ```ts
    // For critical operations
    retry: {
      maxAttempts: 5,
      minTimeoutInMs: 2000,
      maxTimeoutInMs: 30000,
      factor: 2,
    }

    // For less critical operations
    retry: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 5000,
      factor: 1.5,
    }
    ```
  </Accordion>
</Accordions>

## Next steps

With trigger.dev integrated into your TurboStarter application, you can now:

* **Handle long-running operations** that would timeout in serverless functions
* **Schedule recurring tasks** like reports, cleanups, and maintenance
* **Process background jobs** reliably with automatic retries
* **Scale your application** without worrying about task execution infrastructure

Ready to explore more advanced features? Check out the official documentation for additional capabilities like webhooks, batching, and custom integrations.

<Cards>
  <Card title="Documentation" description="trigger.dev" href="https://trigger.dev/docs" />

  <Card title="Examples" description="trigger.dev" href="https://trigger.dev/docs/guides/introduction" />
</Cards>
