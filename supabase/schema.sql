-- ============================================================================
-- ENS Subname Manager — Supabase schema
-- Run in the Supabase SQL Editor.
--
-- Access model: SERVER-SIDE ONLY via the service-role key. Tables have RLS on
-- with NO anon/authenticated policies, and privileges are granted only to
-- service_role (which bypasses RLS). Nothing is reachable from the browser.
-- ============================================================================

-- 1) Enrolled organizations: verified email domain -> ENS parent name.
create table if not exists public.orgs (
  domain        text primary key,                         -- e.g. 'acme.com'
  parent        text not null,                            -- e.g. 'acme.eth'
  subregistry   text,                                     -- deployed UserRegistry addr (null until set)
  issuance      text not null default 'onchain'
                  check (issuance in ('onchain', 'offchain')),
  owner_model   text not null default 'platform'          -- who controls the parent
                  check (owner_model in ('platform', 'user')),
  parent_owner  text,                                     -- address that owns the parent
  status        text not null default 'active'
                  check (status in ('active', 'pending', 'taken')),
  open_enrollment boolean not null default false,         -- true: anyone may claim under this parent
  admin_email   text,                                     -- the org's admin (bootstrap; set on provision)
  verify_token  text,                                     -- DNS-TXT domain-verification challenge
  domain_verified_at timestamptz,                         -- when the admin proved domain control
  commit_secret text,                                     -- commit/reveal secret while pending
  ready_at      timestamptz,                              -- when the commitment matures (pending)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1a) Columns added after the initial table. Run these if your orgs table predates them:
--       alter table public.orgs add column if not exists commit_secret text;
--       alter table public.orgs add column if not exists ready_at timestamptz;
--       alter table public.orgs add column if not exists open_enrollment boolean not null default false;
--       alter table public.orgs add column if not exists admin_email text;
--       alter table public.orgs add column if not exists verify_token text;
--       alter table public.orgs add column if not exists domain_verified_at timestamptz;
--     (commit_secret holds the commit/reveal secret while status='pending'; open_enrollment lets
--      anyone claim under the parent regardless of email domain; admin_email is the org's admin.)
--     To open the demo org and make yourself its admin (use YOUR login email):
--       update public.orgs set open_enrollment = true where parent = 'democlub.eth';
--       update public.orgs set admin_email = 'you@example.com' where parent = 'democlub.eth';

-- 2) Issued subnames: an index/cache of on-chain issuance (for UX + duplicate checks).
create table if not exists public.subnames (
  fqdn          text primary key,                         -- 'jayden6297.democlub.eth'
  label         text not null,                            -- 'jayden6297'
  parent        text not null,                            -- 'democlub.eth'
  owner         text not null,                            -- recipient address
  subregistry   text,
  tx_hash       text,
  claimed_by    text,                                     -- Privy user id (avoid storing raw email)
  domain        text,                                     -- verified domain at claim time
  created_at    timestamptz not null default now()
);
create index if not exists subnames_parent_idx on public.subnames (parent);
create index if not exists subnames_owner_idx on public.subnames (owner);

-- 2b) Reservations: CSV bulk-import invites (email -> reserved label under a parent). A member with
--     a reservation may claim it on sign-in (eligibility), even without a domain match.
create table if not exists public.reservations (
  parent      text not null,
  email       text not null,
  label       text not null,
  claimed     boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (parent, email),
  unique (parent, label)
);
create index if not exists reservations_email_idx on public.reservations (email);

-- 2c) Domain verifications: an admin proves control of their email DOMAIN via a DNS-TXT challenge.
--     Verification is required before they can register (provision) their org's parent name.
create table if not exists public.domain_verifications (
  domain      text primary key,
  token       text,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

-- 3) Lock down: RLS on, privileges granted only to the server (service_role).
alter table public.orgs enable row level security;
alter table public.subnames enable row level security;
alter table public.reservations enable row level security;
alter table public.domain_verifications enable row level security;
grant all on table public.orgs to service_role;
grant all on table public.subnames to service_role;
grant all on table public.reservations to service_role;
grant all on table public.domain_verifications to service_role;
-- (No policies for anon/authenticated => no browser access. service_role bypasses RLS.)

-- 4) Seed current enrollments (edit freely).
--    NOTE: 'gmail.com' is a TEST entry (a public provider would never be an org) —
--    remove it before any real deployment. democlub.eth's subregistry was deployed
--    during `npm run issue:subname`.
insert into public.orgs (domain, parent, subregistry, issuance, owner_model, parent_owner) values
  ('democlub.com', 'democlub.eth', '0x2c84e9d47999856BD4bf8cdd122Ab96925A782B8', 'onchain', 'platform', '0x2987C74ce580e4b5bd9c77C47918e84F226DBdF6'),
  ('gmail.com',    'democlub.eth', '0x2c84e9d47999856BD4bf8cdd122Ab96925A782B8', 'onchain', 'platform', '0x2987C74ce580e4b5bd9c77C47918e84F226DBdF6')
on conflict (domain) do nothing;
