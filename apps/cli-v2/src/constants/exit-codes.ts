export const EXIT = {
  SUCCESS: 0,
  USER_CANCELLED: 1,
  AUTH_FAILED: 2,
  INVALID_ARGS: 3,
  NETWORK_ERROR: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  INTERNAL_ERROR: 8,
  CLAUDE_MISSING: 9,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
