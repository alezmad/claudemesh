-- Peer session persistence: save state on disconnect, restore on reconnect.
CREATE TABLE IF NOT EXISTS mesh.peer_state (
  id TEXT PRIMARY KEY NOT NULL,
  mesh_id TEXT NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE ON UPDATE CASCADE,
  member_id TEXT NOT NULL REFERENCES mesh.member(id) ON DELETE CASCADE ON UPDATE CASCADE,
  groups JSONB DEFAULT '[]',
  profile JSONB DEFAULT '{}',
  visible BOOLEAN NOT NULL DEFAULT true,
  last_summary TEXT,
  last_display_name TEXT,
  cumulative_stats JSONB DEFAULT '{"messagesIn":0,"messagesOut":0,"toolCalls":0,"errors":0}',
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT peer_state_mesh_member_idx UNIQUE (mesh_id, member_id)
);
