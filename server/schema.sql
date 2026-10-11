-- FundLens schema. Money is NUMERIC (exact decimal), never FLOAT.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- scheme_code is AMFI's unique id for a fund plan, so it is the natural key.
CREATE TABLE funds (
  scheme_code INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  fund_house  TEXT,
  category    TEXT
);

-- One row per fund per business day. Composite PK = no duplicates + fast "latest NAV on/before date" lookups.
CREATE TABLE nav_history (
  scheme_code INTEGER NOT NULL REFERENCES funds(scheme_code),
  nav_date    DATE    NOT NULL,
  nav         NUMERIC(14,4) NOT NULL CHECK (nav > 0),
  PRIMARY KEY (scheme_code, nav_date)
);

CREATE TYPE txn_type AS ENUM ('SIP', 'LUMPSUM', 'REDEMPTION');

CREATE TABLE transactions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheme_code INTEGER NOT NULL REFERENCES funds(scheme_code),
  type        txn_type NOT NULL,
  txn_date    DATE NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  units       NUMERIC(14,4) NOT NULL CHECK (units > 0),
  nav         NUMERIC(14,4) NOT NULL,  -- NAV used, kept for audit
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transactions_user_fund_idx ON transactions (user_id, scheme_code, txn_date);
