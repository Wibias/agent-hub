create extension if not exists vector with schema extensions;

create schema if not exists reference_graph;

create table reference_graph.sources (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null unique,
  source_kind text not null,
  title text,
  source_family text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reference_graph.assets (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references reference_graph.sources(id) on delete cascade,
  asset_kind text not null,
  canonical_locator text not null,
  title text,
  media_type text,
  captured_at timestamptz not null,
  content_hash text,
  storage_policy text,
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index reference_graph_assets_identity_idx
  on reference_graph.assets (source_id, canonical_locator, content_hash)
  where content_hash is not null;

create table reference_graph.chunks (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  unique (asset_id, ordinal)
);

create index reference_graph_chunks_search_idx
  on reference_graph.chunks using gin (search_vector);

create table reference_graph.tags (
  id bigint generated always as identity primary key,
  slug text not null unique,
  label text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table reference_graph.asset_tags (
  asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  tag_id bigint not null references reference_graph.tags(id) on delete cascade,
  primary key (asset_id, tag_id)
);

create table reference_graph.relations (
  id uuid primary key default gen_random_uuid(),
  from_asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  to_asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  relation_type text not null,
  weight double precision not null default 1 check (weight >= 0 and weight <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (from_asset_id <> to_asset_id)
);

create index reference_graph_relations_from_idx
  on reference_graph.relations (from_asset_id, relation_type);
create index reference_graph_relations_to_idx
  on reference_graph.relations (to_asset_id, relation_type);

create table reference_graph.observations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  observation_kind text not null,
  body text not null,
  evidence_class text not null,
  observed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index reference_graph_observations_asset_idx
  on reference_graph.observations (asset_id, observation_kind);

create table reference_graph.collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table reference_graph.collection_items (
  collection_id uuid not null references reference_graph.collections(id) on delete cascade,
  asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  ordinal integer not null default 0 check (ordinal >= 0),
  note text,
  primary key (collection_id, asset_id)
);

create table reference_graph.embeddings (
  chunk_id uuid not null references reference_graph.chunks(id) on delete cascade,
  model_id text not null,
  model_revision text not null,
  text_hash text not null,
  dimensions integer not null check (dimensions = 384),
  embedding extensions.vector(384) not null,
  indexed_at timestamptz not null default now(),
  primary key (chunk_id, model_id, model_revision)
);

create index reference_graph_embeddings_hnsw_idx
  on reference_graph.embeddings
  using hnsw (embedding vector_cosine_ops);

create table reference_graph.usage_feedback (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references reference_graph.assets(id) on delete cascade,
  project_id text,
  query text,
  outcome text not null check (outcome in ('selected', 'helpful', 'neutral', 'rejected')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index reference_graph_usage_feedback_asset_idx
  on reference_graph.usage_feedback (asset_id, created_at desc);

alter table reference_graph.sources enable row level security;
alter table reference_graph.assets enable row level security;
alter table reference_graph.chunks enable row level security;
alter table reference_graph.tags enable row level security;
alter table reference_graph.asset_tags enable row level security;
alter table reference_graph.relations enable row level security;
alter table reference_graph.observations enable row level security;
alter table reference_graph.collections enable row level security;
alter table reference_graph.collection_items enable row level security;
alter table reference_graph.embeddings enable row level security;
alter table reference_graph.usage_feedback enable row level security;

revoke all on schema reference_graph from anon, authenticated;
revoke all on all tables in schema reference_graph from anon, authenticated;
revoke all on all sequences in schema reference_graph from anon, authenticated;

comment on schema reference_graph is
  'Agent Hub reference evidence. Search relevance and graph proximity never confer authority.';
