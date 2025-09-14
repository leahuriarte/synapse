PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA user_version = 3;


CREATE TABLE IF NOT EXISTS embeddings (
  concept_id INTEGER PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector TEXT NOT NULL,                      -- JSON array of floats for simplicity
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Concepts in a graph (domain | syllabus | personal)
CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  norm_label TEXT NOT NULL,
  description TEXT,
  source_graph TEXT NOT NULL CHECK (source_graph IN ('domain','syllabus','personal')),
  provenance TEXT,                    -- JSON string (file/slide/module/outcome etc.)
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_concepts_norm ON concepts(norm_label);
CREATE INDEX IF NOT EXISTS idx_concepts_source ON concepts(source_graph);

-- Edges between concepts (typed)
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  dst_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('prereq','part_of','relates_to')),
  source_graph TEXT NOT NULL CHECK (source_graph IN ('domain','syllabus','personal')),
  weight REAL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_concept_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_concept_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_graph);

-- Mermaid snapshots for rendering (latest wins)
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  graph TEXT NOT NULL CHECK (graph IN ('domain','syllabus','personal')),
  mermaid TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_graph_created ON snapshots(graph, created_at DESC);

-- Raw events (hooks, ingestion logs, etc.)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT,                       -- JSON string
  ts DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Evidence of learner mastery
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chat','quiz','submission','manual')),
  payload TEXT,                       -- JSON string
  confidence REAL CHECK (confidence BETWEEN 0 AND 1),
  ts DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Mastery progress per concept
CREATE TABLE IF NOT EXISTS progress (
  concept_id INTEGER PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  mastery TEXT NOT NULL CHECK (mastery IN ('unknown','learning','known')),
  score REAL,
  last_updated DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Cross-graph alignments
CREATE TABLE IF NOT EXISTS alignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  b_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  a_source TEXT NOT NULL CHECK (a_source IN ('domain','syllabus','personal')),
  b_source TEXT NOT NULL CHECK (b_source IN ('domain','syllabus','personal')),
  method TEXT NOT NULL CHECK (method IN ('exact','embedding','llm')),
  confidence REAL CHECK (confidence BETWEEN 0 AND 1),
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(a_id, b_id, method)
);
