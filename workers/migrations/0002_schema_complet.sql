-- ==================================================================
-- AUTOCARE OS — schéma D1 (2/2) : les 15 tables restantes
-- ==================================================================
-- Porté depuis les 22 migrations MySQL. La conversion a été faite par
-- un script, puis RELUE table par table : une conversion mécanique est
-- un brouillon, pas une livraison. Elle avait d'ailleurs produit un
-- défaut qui aurait tout cassé — voir plus bas.
--
-- ------------------------------------------------------------------
-- LES QUATRE TRADUCTIONS, ET CE QU'ELLES PROTÈGENT
--
-- 1. ENUM(...) → TEXT + CHECK (colonne IN (...))
--
--    Le script avait d'abord écrit CHECK (status IN ('open','closed'))
--    en minuscules, alors que la valeur par défaut est 'OPEN'. Aucune
--    ligne n'aurait pu être insérée. La faute venait d'une seule ligne
--    de code qui lisait la déclaration mise en minuscules au lieu de
--    l'originale. C'est le genre de défaut qu'une relecture attrape et
--    qu'un « ça a l'air bon » laisse passer.
--
-- 2. UNSIGNED → CHECK (colonne >= 0)
--
--    Le point le plus discret de toute la migration. MySQL refusait
--    physiquement un montant négatif ; SQLite ne connaît pas UNSIGNED
--    et l'accepterait sans rien dire.
--
--    Une exception, et elle est juste : `cash_sessions.difference` est
--    le SEUL entier signé du schéma. C'est l'écart de caisse — il doit
--    pouvoir être négatif, puisqu'une caisse peut manquer. La
--    conversion l'a préservé parce que MySQL ne le déclarait pas
--    unsigned : la distinction voulue au lot 12 traverse la migration
--    intacte.
--
-- 3. ON UPDATE CURRENT_TIMESTAMP → un déclencheur par table.
--
-- 4. Les montants restent des ENTIERS de FCFA, comme depuis le premier
--    lot. Aucun arrondi n'est possible.
--
-- ------------------------------------------------------------------
-- CE QUI N'EST PAS REPRIS, ET POURQUOI
--
-- Les cinq index de performance du lot 20 ne sont PAS transposés :
--
--    idx_operations_org_status_priority, idx_operations_org_customer_created,
--    idx_operations_analytics, idx_operations_org_updated, idx_payments_org_paid
--
-- Ils avaient été choisis en lisant le plan d'exécution de MySQL, sur
-- 76 041 opérations réelles. Le planificateur de SQLite est différent :
-- les recopier reviendrait à faire semblant d'avoir mesuré.
--
-- C'EST FAIT : voir `0003_index_de_performance.sql`. Sept index, tous
-- mesurés sur 30 000 dossiers, et un seul des cinq d'origine repris
-- tel quel.
--
-- Les index structurels, eux, sont conservés : clés uniques, colonnes
-- de clés étrangères, et les recherches évidentes.
-- ==================================================================

CREATE TABLE audit_logs (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER CHECK (organization_id >= 0),
  station_id INTEGER CHECK (station_id >= 0),
  user_id INTEGER CHECK (user_id >= 0),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER CHECK (entity_id >= 0),
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  ip_address BLOB,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE bookings (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  service_id INTEGER NOT NULL CHECK (service_id >= 0),
  customer_id INTEGER CHECK (customer_id >= 0),
  vehicle_id INTEGER CHECK (vehicle_id >= 0),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  plate_number TEXT,
  scheduled_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  currency_code TEXT NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CONFIRMED','ARRIVED','NO_SHOW','CANCELLED')),
  operation_id INTEGER CHECK (operation_id >= 0),
  outcome_at TEXT,
  outcome_by_user_id INTEGER CHECK (outcome_by_user_id >= 0),
  outcome_reason TEXT,
  notes TEXT,
  created_by_user_id INTEGER NOT NULL CHECK (created_by_user_id >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (operation_id) REFERENCES operations(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (outcome_by_user_id) REFERENCES users(id),
  FOREIGN KEY (service_id) REFERENCES services(id),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE cash_sessions (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opening_float INTEGER NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  opened_by_user_id INTEGER NOT NULL CHECK (opened_by_user_id >= 0),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  opening_notes TEXT,
  expected_amount INTEGER CHECK (expected_amount >= 0),
  counted_amount INTEGER CHECK (counted_amount >= 0),
  difference INTEGER,
  closed_by_user_id INTEGER CHECK (closed_by_user_id >= 0),
  closed_at TEXT,
  closing_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Colonne CALCULÉE : elle vaut la station tant que la caisse est
  -- ouverte, NULL ensuite. La clé unique interdit alors deux caisses
  -- ouvertes au même endroit — une contrainte UNIQUE tolère autant
  -- de NULL qu'on veut. La règle est dans la base, pas dans un
  -- contrôleur qui pourrait l'oublier.
  open_station_id INTEGER GENERATED ALWAYS AS
    (CASE WHEN status = 'OPEN' THEN station_id END) STORED,
  UNIQUE (open_station_id),
  FOREIGN KEY (closed_by_user_id) REFERENCES users(id),
  FOREIGN KEY (opened_by_user_id) REFERENCES users(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE inspection_photos (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  inspection_id INTEGER NOT NULL CHECK (inspection_id >= 0),
  position TEXT NOT NULL DEFAULT 'OTHER' CHECK (position IN ('FRONT','REAR','LEFT','RIGHT','INTERIOR','DAMAGE','OTHER')),
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  width INTEGER CHECK (width >= 0),
  height INTEGER CHECK (height >= 0),
  caption TEXT,
  uploaded_by_user_id INTEGER NOT NULL CHECK (uploaded_by_user_id >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inspection_id) REFERENCES inspections(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
);

CREATE TABLE inspections (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  operation_id INTEGER NOT NULL CHECK (operation_id >= 0),
  vehicle_id INTEGER NOT NULL CHECK (vehicle_id >= 0),
  type TEXT NOT NULL DEFAULT 'ENTRY' CHECK (type IN ('ENTRY','EXIT')),
  performed_by_user_id INTEGER NOT NULL CHECK (performed_by_user_id >= 0),
  fuel_level TEXT CHECK (fuel_level IN ('EMPTY','QUARTER','HALF','THREE_QUARTERS','FULL')),
  mileage INTEGER CHECK (mileage >= 0),
  has_damage INTEGER NOT NULL DEFAULT 0 CHECK (has_damage IN (0, 1)),
  damage_notes TEXT,
  items_left TEXT,
  observations TEXT,
  customer_present INTEGER NOT NULL DEFAULT 0 CHECK (customer_present IN (0, 1)),
  signature_name TEXT,
  performed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (operation_id,type),
  FOREIGN KEY (operation_id) REFERENCES operations(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (performed_by_user_id) REFERENCES users(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE loyalty_entries (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  program_id INTEGER NOT NULL CHECK (program_id >= 0),
  customer_id INTEGER NOT NULL CHECK (customer_id >= 0),
  type TEXT NOT NULL CHECK (type IN ('EARN','REDEEM','REVERSAL')),
  points INTEGER NOT NULL,
  operation_id INTEGER CHECK (operation_id >= 0),
  related_entry_id INTEGER CHECK (related_entry_id >= 0),
  reward_amount INTEGER CHECK (reward_amount >= 0),
  note TEXT,
  created_by_user_id INTEGER CHECK (created_by_user_id >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Un seul tampon par dossier. Le tampon est écrit quand le dossier
  -- devient réglé : un client qui paie en deux fois déclenche deux
  -- fois le calcul, et un paiement rejoué une troisième. Le
  -- contrôleur vérifie avant d'écrire ; la base, elle, ne peut pas
  -- se tromper.
  earn_operation_id INTEGER GENERATED ALWAYS AS
    (CASE WHEN type = 'EARN' THEN operation_id END) STORED,
  -- Et une utilisation ne s'annule qu'une fois : sans cela, deux
  -- appuis sur « Annuler » rendraient deux fois les tampons.
  reversed_entry_id INTEGER GENERATED ALWAYS AS
    (CASE WHEN type = 'REVERSAL' THEN related_entry_id END) STORED,
  UNIQUE (earn_operation_id),
  UNIQUE (reversed_entry_id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (operation_id) REFERENCES operations(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (program_id) REFERENCES loyalty_programs(id),
  FOREIGN KEY (related_entry_id) REFERENCES loyalty_entries(id)
);

CREATE TABLE loyalty_programs (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  name TEXT NOT NULL DEFAULT 'Carte de fidélité',
  stamps_required INTEGER NOT NULL DEFAULT 10 CHECK (stamps_required >= 0),
  reward_amount INTEGER NOT NULL DEFAULT 5000 CHECK (reward_amount >= 0),
  min_operation_amount INTEGER NOT NULL DEFAULT 0 CHECK (min_operation_amount >= 0),
  status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by_user_id INTEGER CHECK (created_by_user_id >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Même mécanisme : un seul programme ACTIF par entreprise. Deux
  -- rendraient le solde d'un client indéterminé.
  active_organization_id INTEGER GENERATED ALWAYS AS
    (CASE WHEN status = 'ACTIVE' THEN organization_id END) STORED,
  UNIQUE (active_organization_id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE operations (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  vehicle_id INTEGER NOT NULL CHECK (vehicle_id >= 0),
  customer_id INTEGER NOT NULL CHECK (customer_id >= 0),
  service_id INTEGER NOT NULL CHECK (service_id >= 0),
  assigned_user_id INTEGER CHECK (assigned_user_id >= 0),
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','IN_PROGRESS','INSPECTION','WASHING','QUALITY_CHECK','READY','COMPLETED','CANCELLED')),
  status_changed_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL CHECK (price >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason TEXT,
  discount_by_user_id INTEGER CHECK (discount_by_user_id >= 0),
  discounted_at TEXT,
  subscription_id INTEGER CHECK (subscription_id >= 0),
  discount_source TEXT CHECK (discount_source IN ('LOYALTY','SUBSCRIPTION')),
  currency_code TEXT NOT NULL DEFAULT 'XOF',
  started_at TEXT,
  completed_at TEXT,
  released_at TEXT,
  released_by_user_id INTEGER CHECK (released_by_user_id >= 0),
  created_by_user_id INTEGER NOT NULL CHECK (created_by_user_id >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id,reference),
  FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (discount_by_user_id) REFERENCES users(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (released_by_user_id) REFERENCES users(id),
  FOREIGN KEY (service_id) REFERENCES services(id),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE password_resets (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL CHECK (user_id >= 0),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  requested_ip BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (token_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE payments (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  cash_session_id INTEGER CHECK (cash_session_id >= 0),
  operation_id INTEGER CHECK (operation_id >= 0),
  subscription_id INTEGER CHECK (subscription_id >= 0),
  customer_id INTEGER CHECK (customer_id >= 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency_code TEXT NOT NULL DEFAULT 'XOF',
  method TEXT NOT NULL DEFAULT 'CASH' CHECK (method IN ('CASH','MOBILE_MONEY','CARD','BANK_TRANSFER','OTHER')),
  provider TEXT,
  external_reference TEXT,
  status TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PENDING','PAID','FAILED','REFUNDED','CANCELLED')),
  paid_at TEXT,
  recorded_by_user_id INTEGER NOT NULL CHECK (recorded_by_user_id >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (operation_id) REFERENCES operations(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(id),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

CREATE TABLE refresh_tokens (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  user_id INTEGER NOT NULL CHECK (user_id >= 0),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_ip BLOB,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (token_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE services (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id,name),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE subscription_plans (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  name TEXT NOT NULL,
  service_id INTEGER NOT NULL CHECK (service_id >= 0),
  washes INTEGER NOT NULL CHECK (washes >= 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  currency_code TEXT NOT NULL DEFAULT 'XOF',
  validity_days INTEGER NOT NULL DEFAULT 180 CHECK (validity_days >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by_user_id INTEGER CHECK (created_by_user_id >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE subscriptions (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  customer_id INTEGER NOT NULL CHECK (customer_id >= 0),
  plan_id INTEGER NOT NULL CHECK (plan_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  service_id INTEGER NOT NULL CHECK (service_id >= 0),
  washes_total INTEGER NOT NULL CHECK (washes_total >= 0),
  price_paid INTEGER NOT NULL CHECK (price_paid >= 0),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  cancelled_at TEXT,
  cancelled_by_user_id INTEGER CHECK (cancelled_by_user_id >= 0),
  cancellation_reason TEXT,
  notes TEXT,
  sold_by_user_id INTEGER NOT NULL CHECK (sold_by_user_id >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id),
  FOREIGN KEY (service_id) REFERENCES services(id),
  FOREIGN KEY (sold_by_user_id) REFERENCES users(id),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

CREATE TABLE time_entries (

  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL CHECK (organization_id >= 0),
  station_id INTEGER NOT NULL CHECK (station_id >= 0),
  user_id INTEGER NOT NULL CHECK (user_id >= 0),
  clock_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  clock_out_at TEXT,
  duration_minutes INTEGER CHECK (duration_minutes >= 0),
  corrected_by_user_id INTEGER CHECK (corrected_by_user_id >= 0),
  corrected_at TEXT,
  correction_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Même mécanisme : un seul pointage ouvert par employé.
  open_user_id INTEGER GENERATED ALWAYS AS
    (CASE WHEN clock_out_at IS NULL THEN user_id END) STORED,
  UNIQUE (open_user_id),
  FOREIGN KEY (corrected_by_user_id) REFERENCES users(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (station_id) REFERENCES stations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_audit_org_date ON audit_logs (organization_id,created_at);

CREATE INDEX idx_audit_entity ON audit_logs (entity_type,entity_id);

CREATE INDEX idx_audit_user ON audit_logs (user_id);

CREATE INDEX idx_audit_action ON audit_logs (action);

CREATE INDEX fk_audit_station ON audit_logs (station_id);

CREATE INDEX idx_bookings_day ON bookings (organization_id,station_id,scheduled_at);

CREATE INDEX idx_bookings_status ON bookings (organization_id,status,scheduled_at);

CREATE INDEX idx_bookings_customer ON bookings (customer_id);

CREATE INDEX idx_bookings_vehicle ON bookings (vehicle_id);

CREATE INDEX idx_bookings_operation ON bookings (operation_id);

CREATE INDEX idx_bookings_phone ON bookings (organization_id,customer_phone);

CREATE INDEX fk_bookings_station ON bookings (station_id);

CREATE INDEX fk_bookings_service ON bookings (service_id);

CREATE INDEX fk_bookings_outcome_by ON bookings (outcome_by_user_id);

CREATE INDEX fk_bookings_created_by ON bookings (created_by_user_id);

CREATE INDEX idx_cash_sessions_station ON cash_sessions (organization_id,station_id,opened_at);

CREATE INDEX fk_cash_sessions_station ON cash_sessions (station_id);

CREATE INDEX fk_cash_sessions_opened_by ON cash_sessions (opened_by_user_id);

CREATE INDEX fk_cash_sessions_closed_by ON cash_sessions (closed_by_user_id);

CREATE INDEX idx_inspection_photos_inspection ON inspection_photos (inspection_id);

CREATE INDEX idx_inspection_photos_org ON inspection_photos (organization_id);

CREATE INDEX fk_inspection_photos_uploaded_by ON inspection_photos (uploaded_by_user_id);

CREATE INDEX idx_inspections_vehicle ON inspections (vehicle_id);

CREATE INDEX idx_inspections_org ON inspections (organization_id);

CREATE INDEX fk_inspections_performed_by ON inspections (performed_by_user_id);

CREATE INDEX idx_loyalty_entries_customer ON loyalty_entries (organization_id,customer_id,created_at);

CREATE INDEX idx_loyalty_entries_operation ON loyalty_entries (operation_id);

CREATE INDEX fk_loyalty_entries_program ON loyalty_entries (program_id);

CREATE INDEX fk_loyalty_entries_customer ON loyalty_entries (customer_id);

CREATE INDEX fk_loyalty_entries_related ON loyalty_entries (related_entry_id);

CREATE INDEX fk_loyalty_entries_created_by ON loyalty_entries (created_by_user_id);

CREATE INDEX idx_loyalty_programs_org ON loyalty_programs (organization_id);

CREATE INDEX fk_loyalty_programs_created_by ON loyalty_programs (created_by_user_id);

CREATE INDEX idx_operations_queue ON operations (organization_id,station_id,status,priority);

CREATE INDEX idx_operations_vehicle ON operations (vehicle_id);

CREATE INDEX idx_operations_customer ON operations (customer_id);

CREATE INDEX idx_operations_assigned ON operations (assigned_user_id);

CREATE INDEX idx_operations_org_created ON operations (organization_id,created_at);

CREATE INDEX fk_operations_station ON operations (station_id);

CREATE INDEX fk_operations_service ON operations (service_id);

CREATE INDEX fk_operations_released_by ON operations (released_by_user_id);

CREATE INDEX fk_operations_created_by ON operations (created_by_user_id);

CREATE INDEX fk_operations_discount_by ON operations (discount_by_user_id);

CREATE INDEX idx_operations_subscription ON operations (subscription_id);

CREATE INDEX idx_password_resets_user ON password_resets (user_id);

CREATE INDEX idx_payments_station_date ON payments (organization_id,station_id,paid_at);

CREATE INDEX idx_payments_operation ON payments (operation_id);

CREATE INDEX idx_payments_customer ON payments (customer_id);

CREATE INDEX fk_payments_station ON payments (station_id);

CREATE INDEX fk_payments_recorded_by ON payments (recorded_by_user_id);

CREATE INDEX idx_payments_cash_session ON payments (cash_session_id);

CREATE INDEX idx_payments_subscription ON payments (subscription_id);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

CREATE INDEX idx_refresh_tokens_expiry ON refresh_tokens (expires_at);

CREATE INDEX fk_refresh_tokens_organization ON refresh_tokens (organization_id);

CREATE INDEX idx_subscription_plans_org ON subscription_plans (organization_id,status);

CREATE INDEX fk_subscription_plans_service ON subscription_plans (service_id);

CREATE INDEX fk_subscription_plans_created_by ON subscription_plans (created_by_user_id);

CREATE INDEX idx_subscriptions_customer ON subscriptions (organization_id,customer_id,status,expires_at);

CREATE INDEX idx_subscriptions_plan ON subscriptions (plan_id);

CREATE INDEX idx_subscriptions_station ON subscriptions (station_id);

CREATE INDEX fk_subscriptions_customer ON subscriptions (customer_id);

CREATE INDEX fk_subscriptions_service ON subscriptions (service_id);

CREATE INDEX fk_subscriptions_sold_by ON subscriptions (sold_by_user_id);

CREATE INDEX fk_subscriptions_cancelled_by ON subscriptions (cancelled_by_user_id);

CREATE INDEX idx_time_entries_station_date ON time_entries (organization_id,station_id,clock_in_at);

CREATE INDEX idx_time_entries_user ON time_entries (user_id,clock_in_at);

CREATE INDEX fk_time_entries_station ON time_entries (station_id);

CREATE INDEX fk_time_entries_corrected_by ON time_entries (corrected_by_user_id);

CREATE TRIGGER trg_bookings_updated AFTER UPDATE ON bookings
BEGIN UPDATE bookings SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_cash_sessions_updated AFTER UPDATE ON cash_sessions
BEGIN UPDATE cash_sessions SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_inspections_updated AFTER UPDATE ON inspections
BEGIN UPDATE inspections SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_loyalty_programs_updated AFTER UPDATE ON loyalty_programs
BEGIN UPDATE loyalty_programs SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_operations_updated AFTER UPDATE ON operations
BEGIN UPDATE operations SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_payments_updated AFTER UPDATE ON payments
BEGIN UPDATE payments SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_services_updated AFTER UPDATE ON services
BEGIN UPDATE services SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_subscription_plans_updated AFTER UPDATE ON subscription_plans
BEGIN UPDATE subscription_plans SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_subscriptions_updated AFTER UPDATE ON subscriptions
BEGIN UPDATE subscriptions SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_time_entries_updated AFTER UPDATE ON time_entries
BEGIN UPDATE time_entries SET updated_at = datetime('now') WHERE id = NEW.id; END;
