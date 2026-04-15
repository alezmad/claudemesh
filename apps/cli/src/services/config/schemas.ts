export interface JoinedMesh {
  meshId: string;
  memberId: string;
  slug: string;
  name: string;
  pubkey: string;
  secretKey: string;
  brokerUrl: string;
  joinedAt: string;
  rootKey?: string;
  inviteVersion?: 1 | 2;
}

export interface GroupEntry {
  name: string;
  role?: string;
}

export interface Config {
  version: 1;
  meshes: JoinedMesh[];
  displayName?: string;
  role?: string;
  groups?: GroupEntry[];
  messageMode?: "push" | "inbox" | "off";
  accountId?: string;
}

export function emptyConfig(): Config {
  return { version: 1, meshes: [] };
}
