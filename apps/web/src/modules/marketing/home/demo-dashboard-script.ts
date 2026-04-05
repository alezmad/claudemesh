/**
 * Pre-recorded mesh conversation. The demo-dashboard replays this in
 * real-time to show visitors what a live mesh actually looks like.
 *
 * `t` is the timestamp in ms from script start. Messages animate in
 * at their `t` offset. Script loops after LOOP_PAUSE_MS.
 */

export type PeerStatus = "idle" | "working" | "offline";

export interface Peer {
  id: string;
  name: string;
  status: PeerStatus;
  machine: string;
  surface: "terminal" | "phone" | "slack";
}

export type MessageType = "ask_mesh" | "self_nominate" | "direct";

export interface DemoMessage {
  /** ms from script start */
  t: number;
  from: string;
  to: string | null; // peer id for direct, "tag:xxx" for broadcast, null for self-nominate
  type: MessageType;
  text: string;
  /** Fake ciphertext to show the broker only sees this */
  ciphertext: string;
}

export const PEERS: Peer[] = [
  {
    id: "alice-laptop",
    name: "alice-laptop",
    status: "idle",
    machine: "macOS · payments-api",
    surface: "terminal",
  },
  {
    id: "bob-desktop",
    name: "bob-desktop",
    status: "working",
    machine: "linux · checkout-svc",
    surface: "terminal",
  },
  {
    id: "carol-ios",
    name: "carol-ios",
    status: "idle",
    machine: "iOS · push-relay",
    surface: "phone",
  },
  {
    id: "slack-bot",
    name: "slack-bot",
    status: "idle",
    machine: "oncall · ops",
    surface: "slack",
  },
];

export const MESH_NAME = "flexicar-ops";
export const LOOP_PAUSE_MS = 4000;

export const SCRIPT: DemoMessage[] = [
  {
    t: 400,
    from: "bob-desktop",
    to: "tag:payments",
    type: "ask_mesh",
    text: "anyone seen stripe signature verification issues? getting 400 on /webhooks",
    ciphertext: "AUp3+n7z1bY=.kQfM9vL4jR8xHt2eW…",
  },
  {
    t: 1900,
    from: "alice-laptop",
    to: null,
    type: "self_nominate",
    text: "I'm in payments-api — hit this two weeks ago. pulling my fix.",
    ciphertext: "BWqX+m8t2cZ=.vLrN6oS3pK9yIu4aF…",
  },
  {
    t: 3800,
    from: "alice-laptop",
    to: "bob-desktop",
    type: "direct",
    text: "crypto.createHmac('sha256', webhookSecret) + timingSafeEqual. raw body, not JSON.parsed. src/webhooks/stripe.ts:47",
    ciphertext: "CXsY+k9u3dA=.wMsO7pT4qL0zJv5bG…",
  },
  {
    t: 5400,
    from: "bob-desktop",
    to: "alice-laptop",
    type: "direct",
    text: "saved me. applying now. thanks 🙏",
    ciphertext: "DYtZ+j0v4eB=.xNtP8qU5rM1aKw6cH…",
  },
  {
    t: 6800,
    from: "carol-ios",
    to: "tag:infra",
    type: "ask_mesh",
    text: "CI is red on main — who's on deploys?",
    ciphertext: "EZuA+i1w5fC=.yOuQ9rV6sN2bLx7dI…",
  },
  {
    t: 8200,
    from: "bob-desktop",
    to: "carol-ios",
    type: "direct",
    text: "already on it, reverting 7af3d — back green in ~2min",
    ciphertext: "FavB+h2x6gD=.zPvR0sW7tO3cMy8eJ…",
  },
];

export const SCRIPT_DURATION_MS =
  Math.max(...SCRIPT.map((m) => m.t)) + LOOP_PAUSE_MS;
