import type { UserConfig } from "@commitlint/types";

const Configuration: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // body-max-length capped TOTAL body length at 100 chars — meaningless
    // for technical commits, fired a warning on every substantive
    // changelog-style message. Disabled (level 0).
    "body-max-length": [0, "always", 0],
    // Per-line body cap. Bumped from 100 to 200 so long URLs, file
    // paths, and copy-pasted error lines don't trip a warning that
    // adds nothing — but still catches accidental no-wrap.
    "body-max-line-length": [1, "always", 200],
  },
};

export default Configuration;
