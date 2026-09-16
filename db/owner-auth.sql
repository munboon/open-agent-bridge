-- Owner authentication schema for better-auth 1.7.3, twoFactor plugin,
-- database rate limiting, and the server-only bridgeMfaVerified session field.
-- Derived from installed better-auth/db getSchema(); no automatic runtime DDL.
-- The migration runner owns the surrounding transaction and checksum record.
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "twoFactorEnabled" boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "bridgeMfaVerified" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session"("userId");
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account("userId");
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_idx ON account("providerId", "accountId");
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE TABLE IF NOT EXISTS "twoFactor" (
  id text PRIMARY KEY, secret text NOT NULL, "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified boolean DEFAULT true, "failedVerificationCount" integer DEFAULT 0, "lockedUntil" timestamptz
);
CREATE INDEX IF NOT EXISTS two_factor_secret_idx ON "twoFactor"(secret);
CREATE UNIQUE INDEX IF NOT EXISTS two_factor_user_id_idx ON "twoFactor"("userId");
CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS bridge_owner_state (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true
);
