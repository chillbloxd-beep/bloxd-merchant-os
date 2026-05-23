const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders }
  });
}

function bad(error, status = 400) {
  return json({ error: String(error?.message || error) }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/health") return json({ ok: true, name: "Bloxd Merchant OS API" });

      if (path === "/api/items" && request.method === "GET") {
        const search = url.searchParams.get("search") || "";
        const limit = Math.min(Number(url.searchParams.get("limit") || 200), 3000);
        let stmt;
        if (search) {
          stmt = env.DB.prepare(`
            SELECT * FROM items
            WHERE name LIKE ? OR category LIKE ? OR meta_codes LIKE ?
            ORDER BY is_tradeable DESC, name ASC
            LIMIT ?
          `).bind(`%${search}%`, `%${search}%`, `%${search}%`, limit);
        } else {
          stmt = env.DB.prepare(`SELECT * FROM items ORDER BY is_tradeable DESC, name ASC LIMIT ?`).bind(limit);
        }
        const { results } = await stmt.all();
        return json({ items: results });
      }

      if (path === "/api/items/import" && request.method === "POST") {
        const body = await request.json();
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return bad("No items provided.");

        const batch = items.slice(0, 5000).map(item => env.DB.prepare(`
          INSERT INTO items (name, raw_line, meta_codes, category, is_internal, is_placeholder, is_tradeable)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            raw_line=excluded.raw_line,
            meta_codes=excluded.meta_codes,
            category=excluded.category,
            is_internal=excluded.is_internal,
            is_placeholder=excluded.is_placeholder,
            is_tradeable=excluded.is_tradeable,
            updated_at=datetime('now')
        `).bind(
          String(item.name || "").trim(),
          String(item.raw_line || item.name || "").trim(),
          String(item.meta_codes || "").trim(),
          String(item.category || "Other").trim(),
          Number(item.is_internal || 0),
          Number(item.is_placeholder || 0),
          Number(item.is_tradeable ?? 1)
        ));

        await env.DB.batch(batch);
        return json({ ok: true, imported: batch.length });
      }

      if (path === "/api/trades" && request.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit") || 100), 1000);
        const { results } = await env.DB.prepare(`
          SELECT t.*, i.name AS item_name, i.category, i.meta_codes,
            CASE
              WHEN t.trade_type LIKE 'BUY_%' THEN -((t.quantity * t.unit_price) + t.fee)
              ELSE ((t.quantity * t.unit_price) - t.fee)
            END AS cashflow
          FROM trades t
          JOIN items i ON i.id = t.item_id
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT ?
        `).bind(limit).all();
        return json({ trades: results });
      }

      if (path === "/api/trades" && request.method === "POST") {
        const body = await request.json();
        const allowed = ["BUY_ORDER", "BUY_MARKET", "SELL_ORDER", "SELL_MARKET"];
        if (!allowed.includes(body.trade_type)) return bad("Invalid trade type.");
        if (!Number(body.item_id)) return bad("Missing item_id.");
        if (Number(body.quantity) <= 0) return bad("Quantity must be above 0.");
        if (Number(body.unit_price) < 0) return bad("Unit price cannot be negative.");

        const result = await env.DB.prepare(`
          INSERT INTO trades (item_id, trade_type, quantity, unit_price, fee, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          Number(body.item_id),
          body.trade_type,
          Number(body.quantity),
          Number(body.unit_price),
          Number(body.fee || 0),
          String(body.notes || "")
        ).run();

        return json({ ok: true, id: result.meta.last_row_id });
      }

      if (path === "/api/stats/summary" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN trade_type LIKE 'BUY_%' THEN quantity * unit_price + fee ELSE 0 END), 0) AS spent,
            COALESCE(SUM(CASE WHEN trade_type LIKE 'SELL_%' THEN quantity * unit_price - fee ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(fee), 0) AS fees
          FROM trades
        `).all();
        const row = results[0] || {};
        const spent = Number(row.spent || 0);
        const revenue = Number(row.revenue || 0);
        const realized_profit = revenue - spent;
        const roi = spent > 0 ? realized_profit / spent * 100 : 0;
        return json({ spent, revenue, fees: Number(row.fees || 0), realized_profit, roi });
      }

      if (path === "/api/inventory" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          WITH buys AS (
            SELECT item_id, SUM(quantity) AS bought_qty, SUM(quantity * unit_price + fee) AS buy_cost
            FROM trades WHERE trade_type LIKE 'BUY_%' GROUP BY item_id
          ),
          sells AS (
            SELECT item_id, SUM(quantity) AS sold_qty
            FROM trades WHERE trade_type LIKE 'SELL_%' GROUP BY item_id
          )
          SELECT i.id AS item_id, i.name AS item_name, i.category,
            COALESCE(b.bought_qty, 0) - COALESCE(s.sold_qty, 0) AS quantity,
            CASE WHEN COALESCE(b.bought_qty, 0) > 0 THEN b.buy_cost / b.bought_qty ELSE 0 END AS avg_cost,
            (COALESCE(b.bought_qty, 0) - COALESCE(s.sold_qty, 0)) *
            CASE WHEN COALESCE(b.bought_qty, 0) > 0 THEN b.buy_cost / b.bought_qty ELSE 0 END AS cost_basis
          FROM items i
          LEFT JOIN buys b ON b.item_id = i.id
          LEFT JOIN sells s ON s.item_id = i.id
          WHERE COALESCE(b.bought_qty, 0) - COALESCE(s.sold_qty, 0) != 0
          ORDER BY cost_basis DESC
        `).all();
        return json({ inventory: results });
      }

      if (path === "/api/history/blocks" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          WITH grouped AS (
            SELECT
              item_id,
              SUM(CASE WHEN trade_type LIKE 'BUY_%' THEN quantity ELSE 0 END) AS bought_qty,
              SUM(CASE WHEN trade_type LIKE 'SELL_%' THEN quantity ELSE 0 END) AS sold_qty,
              SUM(CASE WHEN trade_type LIKE 'BUY_%' THEN quantity * unit_price + fee ELSE 0 END) AS buy_cost,
              SUM(CASE WHEN trade_type LIKE 'SELL_%' THEN quantity * unit_price - fee ELSE 0 END) AS sell_revenue
            FROM trades
            GROUP BY item_id
          )
          SELECT
            i.id AS item_id,
            i.name AS item_name,
            i.category,
            g.bought_qty,
            g.sold_qty,
            g.bought_qty - g.sold_qty AS holding_qty,
            CASE WHEN g.bought_qty > 0 THEN g.buy_cost / g.bought_qty ELSE 0 END AS avg_buy,
            CASE WHEN g.sold_qty > 0 THEN g.sell_revenue / g.sold_qty ELSE 0 END AS avg_sell,
            (
              g.sell_revenue -
              (CASE WHEN g.bought_qty > 0 THEN (g.buy_cost / g.bought_qty) * g.sold_qty ELSE 0 END)
            ) AS realized_profit,
            CASE
              WHEN g.sold_qty > 0 AND g.bought_qty > 0 THEN
                (
                  (g.sell_revenue - ((g.buy_cost / g.bought_qty) * g.sold_qty)) /
                  ((g.buy_cost / g.bought_qty) * g.sold_qty)
                ) * 100
              ELSE 0
            END AS roi
          FROM grouped g
          JOIN items i ON i.id = g.item_id
          ORDER BY realized_profit DESC
        `).all();
        return json({ history: results });
      }

      return bad("Not found", 404);
    } catch (error) {
      return bad(error, 500);
    }
  }
};
