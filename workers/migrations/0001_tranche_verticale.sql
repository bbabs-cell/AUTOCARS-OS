-- ==================================================================
-- AUTOCARE OS — schéma D1 (1/2) : les tables de la tranche verticale
-- ==================================================================
-- organizations, users, stations, station_users, customers, vehicles.
--
-- ------------------------------------------------------------------
-- CE FICHIER A ÉTÉ RÉÉCRIT À L'ÉTAPE 2, ET IL FAUT LE DIRE
--
-- À l'étape 1, ces six tables avaient été écrites à la main et
-- volontairement minimales : la tranche verticale n'avait besoin que
-- de se connecter et de lister des véhicules.
--
-- La comparaison colonne par colonne avec le schéma MySQL, faite à
-- l'étape 2, a montré deux choses :
--
--   1. Dix-sept colonnes manquaient (`deleted_at`, `last_login_at`,
--      `address`, `opens_at`…). Attendues par le code, elles auraient
--      manqué au premier écran qui les lit.
--
--   2. Deux contraintes étaient INFIDÈLES. `users.status` acceptait
--      ('ACTIVE','SUSPENDED') alors que MySQL déclare
--      ('ACTIVE','INVITED','DISABLED') : un compte invité aurait été
--      refusé par la base. Idem pour `stations.status`, écrit
--      ('ACTIVE','CLOSED') au lieu de ('ACTIVE','INACTIVE').
--
-- Le second point est le plus instructif : une valeur d'énumération
-- recopiée de mémoire plutôt que du schéma. C'est passé inaperçu à
-- l'étape 1 parce que rien n'y touchait à ces statuts.
--
-- Plutôt que d'empiler une migration corrective sur une migration
-- fausse, ce fichier a été RÉGÉNÉRÉ depuis le schéma MySQL, par le
-- même script que le fichier 0002. C'est possible SANS DANGER parce
-- que rien n'est encore déployé : aucune base réelle n'a jamais
-- exécuté la version précédente. Le jour où ce sera le cas, la seule
-- voie sera d'ajouter une migration.
--
-- ------------------------------------------------------------------
-- Les traductions MySQL → SQLite sont expliquées dans 0002.
-- ==================================================================

CREATE TABLE organizations (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  country_code TEXT NOT NULL DEFAULT 'SN',
  currency_code TEXT NOT NULL DEFAULT 'XOF',
  timezone TEXT NOT NULL DEFAULT 'Africa/Dakar',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  onboarding_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (slug)
);

CREATE TABLE users (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INVITED','DISABLED')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE (email),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE stations (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  phone TEXT,
  code TEXT NOT NULL,
  opens_at TEXT,
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id,code),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE station_users (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  user_id INTEGER NOT NULL CHECK (user_id >= 0),
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','EMPLOYEE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (station_id,user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE customers (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE vehicles (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  customer_id INTEGER NOT NULL CHECK (customer_id >= 0),
  plate_number TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'CAR' CHECK (vehicle_type IN ('CAR','SUV','PICKUP','VAN','MOTORCYCLE','TRUCK','OTHER')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE (organization_id,plate_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX idx_customers_org_phone ON customers (organization_id,phone);

CREATE INDEX idx_customers_org_name ON customers (organization_id,last_name);

CREATE INDEX idx_station_users_user ON station_users (user_id);

CREATE INDEX idx_station_users_org ON station_users (organization_id);

CREATE INDEX idx_users_organization ON users (organization_id);

CREATE INDEX idx_vehicles_customer ON vehicles (customer_id);

CREATE TRIGGER trg_customers_updated AFTER UPDATE ON customers
BEGIN UPDATE customers SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_organizations_updated AFTER UPDATE ON organizations
BEGIN UPDATE organizations SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_station_users_updated AFTER UPDATE ON station_users
BEGIN UPDATE station_users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_stations_updated AFTER UPDATE ON stations
BEGIN UPDATE stations SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_users_updated AFTER UPDATE ON users
BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_vehicles_updated AFTER UPDATE ON vehicles
BEGIN UPDATE vehicles SET updated_at = datetime('now') WHERE id = NEW.id; END;
