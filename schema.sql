CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  member_limit INTEGER NOT NULL,
  user_limit INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS churches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL DEFAULT 'Brasil',
  phone TEXT NOT NULL DEFAULT '',
  pastors TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  plan_id TEXT REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'trial')),
  member_count INTEGER NOT NULL DEFAULT 0,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  founder_price_freeze BOOLEAN NOT NULL DEFAULT FALSE,
  founder_plan_price_cents INTEGER,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  price_freeze_until TIMESTAMPTZ,
  public_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  preferred_name TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'unspecified',
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'church_admin', 'reception')),
  job_role TEXT NOT NULL DEFAULT 'Recepção',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_secret_ciphertext TEXT NOT NULL DEFAULT '',
  two_factor_confirmed_at TIMESTAMPTZ,
  two_factor_recovery_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ministries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  family_name TEXT NOT NULL DEFAULT '',
  family_members JSONB NOT NULL DEFAULT '[]'::jsonb,
  arrival_type TEXT NOT NULL DEFAULT 'Sozinho',
  phone TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  service TEXT NOT NULL DEFAULT 'Culto de Celebração',
  invited_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Novo',
  responsible TEXT NOT NULL DEFAULT 'Recepção',
  announced BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS church_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'Toda a igreja',
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  personalize_greeting BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'scheduled', 'cancelled')),
  scheduled_for TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Outro',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  preferred_name TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'unspecified',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  ministry TEXT NOT NULL DEFAULT '',
  ministry_id UUID REFERENCES ministries(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  joined_at DATE,
  communication_consent BOOLEAN NOT NULL DEFAULT FALSE,
  location_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version TEXT NOT NULL DEFAULT '',
  consent_updated_at TIMESTAMPTZ,
  last_attended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS church_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TEXT NOT NULL DEFAULT '19:00',
  location TEXT NOT NULL DEFAULT 'Templo principal',
  event_type TEXT NOT NULL DEFAULT 'Outro',
  audience TEXT NOT NULL DEFAULT 'Toda a igreja',
  status TEXT NOT NULL DEFAULT 'active',
  recurrence_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  recurrence_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  preferred_name TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'unspecified',
  role TEXT NOT NULL DEFAULT 'Líder',
  phone TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  church_id UUID REFERENCES churches(id),
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS church_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL DEFAULT 'general',
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'dark',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event_id UUID REFERENCES church_events(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'web', 'qr', 'import')),
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geo_verified BOOLEAN NOT NULL DEFAULT FALSE,
  distance_m NUMERIC(8,2),
  accuracy_m NUMERIC(8,2),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('communication', 'location', 'privacy')),
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  version TEXT NOT NULL DEFAULT 'v1',
  source TEXT NOT NULL DEFAULT 'church_admin',
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, consent_type)
);

CREATE TABLE IF NOT EXISTS care_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  visitor_id UUID REFERENCES visitors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT 'follow_up' CHECK (task_type IN ('follow_up', 'prayer', 'visit', 'integration', 'other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  due_date DATE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (member_id IS NOT NULL OR visitor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_announcements_church_created ON church_announcements(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_church_created ON church_activity(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_church ON users(church_id);
CREATE INDEX IF NOT EXISTS idx_visitors_church_date ON visitors(church_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_church_member ON member_attendance(church_id, member_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_tasks_church_status ON care_tasks(church_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_member_consents_church ON member_consents(church_id, member_id);
