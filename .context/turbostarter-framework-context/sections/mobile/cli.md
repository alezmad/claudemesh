---
title: CLI
description: Start your new project with a single command.
url: /docs/mobile/cli
---

# CLI

<CliDemo />

To help you get started with TurboStarter **as quickly as possible**, we've developed a [CLI](https://www.npmjs.com/package/@turbostarter/cli) that enables you to create a new project (with all the configuration) in seconds.

The CLI is a set of commands that will help you create a new project, generate code, and manage your project efficiently.

Currently, the following action is available:

* **Starting a new project** - Generate starter code for your project with all necessary configurations in place (billing, database, emails, etc.)

**The CLI is in beta**, and we're actively working on adding more commands and actions. Soon, the following features will be available:

* **Translations** - Translate your project, verify translations, and manage them effectively
* **Installing plugins** - Easily install plugins for your project
* **Dynamic code generation** - Generate dynamic code based on your project structure

## Installation

You can run commands using `npx`:

```bash
npx turbostarter <command>
npx @turbostarter/cli@latest <command>
```

<Callout>
  If you don't want to install the CLI globally, you can simply replace the examples below with `npx @turbostarter/cli@latest` instead of `turbostarter`.

  This also allows you to always run the latest version of the CLI without having to update it.
</Callout>

## Usage

Running the CLI without any arguments will display the general information about the CLI:

```bash
Usage: turbostarter [options] [command]

Your Turbo Assistant for starting new projects, adding plugins and more.

Options:
  -v, --version   display the version number
  -h, --help      display help for command

Commands:
  new             create a new TurboStarter project
  help [command]  display help for command
```

You can also display help for it or check the actual version.

### Starting a new project

Use the `new` command to initialize configuration and dependencies for a new project.

```bash
npx turbostarter new
```

You will be asked a few questions to configure your project:

```bash
✔ All prerequisites are satisfied, let's start! 🚀

? What do you want to ship? ›
    ◉   Web app
    ◉   Mobile app
    ◯   Browser extension
? Enter your project name. ›
? How do you want to use database? ›
    Local (powered by Docker)
    Cloud
? What do you want to use for billing? ›
    Stripe
    Lemon Squeezy

...

🎉 You can now get started. Open the project and just ship it! 🎉

Problems? https://www.turbostarter.dev/docs
```

It will create a new project, configure providers, install dependencies and start required services in development mode.
