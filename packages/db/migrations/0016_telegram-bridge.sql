CREATE TABLE IF NOT EXISTS mesh.telegram_bridge (
  id text PRIMARY KEY NOT NULL,
  chat_id bigint NOT NULL,
  chat_type text DEFAULT 'private',
  chat_title text,
  mesh_id text NOT NULL REFERENCES mesh.mesh(id) ON DELETE CASCADE ON UPDATE CASCADE,
  member_id text REFERENCES mesh.member(id),
  pubkey text NOT NULL,
  secret_key text NOT NULL,
  display_name text DEFAULT 'telegram',
  active boolean DEFAULT true,
  created_at timestamp DEFAULT now() NOT NULL,
  disconnected_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_bridge_chat_mesh_idx ON mesh.telegram_bridge (chat_id, mesh_id);
