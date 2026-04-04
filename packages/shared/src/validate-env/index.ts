/**
 * Runtime Environment Validation
 *
 * Runs once on server startup (via Next.js instrumentation).
 * Validates that required env vars are present BEFORE the app serves requests.
 *
 * Design:
 * - Build time: all env vars are optional (so `next build` works without them)
 * - Runtime: this module checks process.env directly and fails fast with clear messages
 * - Feature-gated: optional features only require their vars when explicitly enabled
 */

type EnvRule = {
  key: string;
  required: boolean;
  reason: string;
};

type FeatureGate = {
  name: string;
  /** The env var that enables this feature (if set and non-empty, feature is "on") */
  gate: string;
  vars: string[];
};

/** Always required in production */
const REQUIRED_VARS: EnvRule[] = [
  {
    key: "DATABASE_URL",
    required: true,
    reason: "App cannot start without a database connection",
  },
  {
    key: "BETTER_AUTH_SECRET",
    required: true,
    reason: "Auth sessions will be insecure without a proper secret",
  },
];

/**
 * Feature-gated vars: only required when the gate var is set.
 * This lets you skip entire features (S3, Stripe, email) without errors.
 */
const FEATURE_GATES: FeatureGate[] = [
  {
    name: "S3 Storage",
    gate: "S3_BUCKET",
    vars: ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  },
  {
    name: "Stripe Billing",
    gate: "STRIPE_SECRET_KEY",
    vars: ["STRIPE_WEBHOOK_SECRET"],
  },
  {
    name: "Resend Email",
    gate: "RESEND_API_KEY",
    vars: ["EMAIL_FROM"],
  },
  {
    name: "Nodemailer Email",
    gate: "NODEMAILER_HOST",
    vars: ["NODEMAILER_PORT", "NODEMAILER_USER", "NODEMAILER_PASSWORD", "EMAIL_FROM"],
  },
];

/** Vars that trigger a warning (not a crash) if missing */
const WARN_VARS = [
  { key: "BETTER_AUTH_TRUSTED_ORIGINS", reason: "CSRF protection may reject external requests" },
  { key: "EMAIL_FROM", reason: "Emails will use 'noreply@example.com' as sender" },
];

function getEnv(key: string): string | undefined {
  const val = process.env[key];
  if (!val || val.trim() === "") return undefined;
  return val;
}

export function validateRuntimeEnv(): void {
  // Skip in development or when explicitly disabled
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SKIP_ENV_VALIDATION === "1" || process.env.SKIP_ENV_VALIDATION === "true") return;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const rule of REQUIRED_VARS) {
    if (!getEnv(rule.key)) {
      errors.push(`  ${rule.key} — ${rule.reason}`);
    }
  }

  // Check feature-gated vars
  for (const feature of FEATURE_GATES) {
    if (getEnv(feature.gate)) {
      for (const varName of feature.vars) {
        if (!getEnv(varName)) {
          errors.push(`  ${varName} — Required when ${feature.name} is enabled (${feature.gate} is set)`);
        }
      }
    }
  }

  // Check warning vars
  for (const rule of WARN_VARS) {
    if (!getEnv(rule.key)) {
      warnings.push(`  ${rule.key} — ${rule.reason}`);
    }
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn(
      `\n⚠️  Environment warnings:\n${warnings.join("\n")}\n`
    );
  }

  // Fail on errors
  if (errors.length > 0) {
    const msg = [
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "❌ Missing required environment variables:",
      "",
      ...errors,
      "",
      "The app cannot start safely without these.",
      "Set them in your docker-compose or .env file.",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
    ].join("\n");

    // Throw instead of process.exit — works in both Node and Edge runtimes
    throw new Error(msg);
  }
}
