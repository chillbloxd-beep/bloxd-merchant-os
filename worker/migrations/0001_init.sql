CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  raw_line TEXT NOT NULL,
  meta_codes TEXT DEFAULT '',
  category TEXT DEFAULT 'Other',
  is_internal INTEGER DEFAULT 0,
  is_placeholder INTEGER DEFAULT 0,
  is_tradeable INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_tradeable ON items(is_tradeable);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('BUY_ORDER', 'BUY_MARKET', 'SELL_ORDER', 'SELL_MARKET')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX IF NOT EXISTS idx_trades_item_id ON trades(item_id);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_type ON trades(trade_type);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  highest_order_price REAL DEFAULT 0,
  lowest_market_price REAL DEFAULT 0,
  fee_estimate REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX IF NOT EXISTS idx_price_item_time ON price_snapshots(item_id, created_at);
