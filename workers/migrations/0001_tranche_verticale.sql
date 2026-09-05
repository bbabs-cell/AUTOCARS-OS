-- ==================================================================
-- AUTOCARE OS — schéma D1, tranche verticale (étape 1)
-- ==================================================================
-- Les cinq tables nécessaires pour se connecter et voir ses
-- véhicules. Les dix-sept autres suivront à l'étape 2.
--
-- ------------------------------------------------------------------
-- CE QUE MySQL FAISAIT ET QUE SQLite NE FAIT PAS
--
-- 1. ENUM(...)  →  TEXT + CHECK (colonne IN (...))
--    Sans le CHECK, n'importe quelle chaîne passerait. La contrainte
--    n'est pas décorative : c'est elle qui remplace la garantie
--    perdue.
--
-- 2. UNSIGNED   →  CHECK (colonne >= 0)
--    C'est le piège le plus discret de cette migration. MySQL refuse
--    physiquement un prix négatif ; SQLite ne connaît pas UNSIGNED et
--    l'accepterait sans rien dire. Une protection perdue en silence
--    est pire qu'une protection absente.
--
-- 3. ON UPDATE CURRENT_TIMESTAMP  →  un déclencheur par table.
--    SQLite n'a pas cet automatisme.
--
-- 4. utf8mb4 / COLLATE  →  rien à faire, SQLite est UTF-8 nativement.
--
-- L'argent, lui, ne pose aucun problème : il est en entiers de FCFA
-- depuis le premier lot, jamais en décimal. Le portage est exact.
-- ==================================================================

CREATE TABLE organizations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL,
  slug                  TEXT    NOT NULL UNIQUE,
  phone                 TEXT,
  email                 TEXT,
  country_code          TEXT    NOT NULL DEFAULT 'SN',
  currency_code         TEXT    NOT NULL DEFAULT 'XOF',
  timezone              TEXT    NOT NULL DEFAULT 'Africa/Dakar',
  onboarding_completed_at TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE,
  phone           TEXT,
  password_hash   TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name            TEXT    NOT NULL,
  code            TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, code)
);

-- Qui travaille où, et avec quel rôle.
CREATE TABLE station_users (
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  station_id      INTEGER NOT NULL REFERENCES stations(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  role            TEXT    NOT NULL
                          CHECK (role IN ('ADMIN', 'MANAGER', 'EMPLOYEE')),
  PRIMARY KEY (station_id, user_id)
);

CREATE TABLE customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  first_name      TEXT    NOT NULL,
  last_name       TEXT    NOT NULL,
  phone           TEXT    NOT NULL,
  email           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  plate_number    TEXT    NOT NULL,
  brand           TEXT    NOT NULL,
  model           TEXT    NOT NULL,
  color           TEXT,
  -- L'ENUM d'origine, devenu une contrainte explicite.
  vehicle_type    TEXT    NOT NULL DEFAULT 'CAR'
                          CHECK (vehicle_type IN
                            ('CAR','SUV','PICKUP','VAN','MOTORCYCLE','TRUCK','OTHER')),
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, plate_number)
);

-- ------------------------------------------------------------------
-- Index : chacun commence par organization_id.
--
-- Ce n'est pas une habitude, c'est la conséquence directe du
-- cloisonnement : AUCUNE requête métier ne s'écrit sans filtrer sur
-- l'organisation, donc aucun index utile ne peut commencer autrement.
--
-- Ce sont les index évidents de la tranche. Les index de performance
-- du lot 20 ne sont PAS transposés : ils ont été choisis en lisant le
-- plan d'exécution de MySQL, et celui de SQLite est différent. Ils
-- seront re-mesurés à l'étape 7 — recopier des index sans les mesurer
-- reviendrait à faire semblant.
-- ------------------------------------------------------------------
CREATE INDEX idx_users_org           ON users (organization_id);
CREATE INDEX idx_station_users_user  ON station_users (user_id);
CREATE INDEX idx_customers_org       ON customers (organization_id);
CREATE INDEX idx_vehicles_org_cust   ON vehicles (organization_id, customer_id);
CREATE INDEX idx_vehicles_org_plate  ON vehicles (organization_id, plate_number);

-- ------------------------------------------------------------------
-- Les déclencheurs qui remplacent ON UPDATE CURRENT_TIMESTAMP.
-- Un par table : SQLite n'a pas d'équivalent déclaratif.
-- ------------------------------------------------------------------
CREATE TRIGGER trg_organizations_updated AFTER UPDATE ON organizations
BEGIN UPDATE organizations SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_users_updated AFTER UPDATE ON users
BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_stations_updated AFTER UPDATE ON stations
BEGIN UPDATE stations SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_customers_updated AFTER UPDATE ON customers
BEGIN UPDATE customers SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_vehicles_updated AFTER UPDATE ON vehicles
BEGIN UPDATE vehicles SET updated_at = datetime('now') WHERE id = NEW.id; END;
