export interface Peer { pubkey: string; display_name: string; status: "idle" | "working" | "dnd" | "offline"; summary?: string; groups: string[]; avatar?: string; title?: string; bio?: string; capabilities?: string[]; }

export interface PeerMessage { from: string; from_name: string; message: string; priority: "now" | "next" | "low"; timestamp: string; }
