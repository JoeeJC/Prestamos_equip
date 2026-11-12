CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

UPDATE usuarios
SET password_hash = extensions.crypt(password_hash, extensions.gen_salt('bf'))
WHERE password_hash NOT LIKE '$2%';

CREATE TABLE IF NOT EXISTS sesiones_usuario (
  id_sesion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_el TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_sesiones_token ON sesiones_usuario(token);

ALTER TABLE sesiones_usuario ENABLE ROW LEVEL SECURITY;
