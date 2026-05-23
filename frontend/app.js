const state = {
  apiUrl: localStorage.getItem("bloxd_api_url") || "",
  selectedTradeType: "BUY_ORDER",
  items: [],
  trades: [],
  summary: null,
  inventory: [],
  history: []
};

const $ = (id) => document.getElementById(id);

const tradeLabels = {
  BUY_ORDER: "Buy from Orders",
  BUY_MARKET: "Buy from Market",
  SELL_ORDER: "Sell to Orders",
  SELL_MARKET: "Sell on Market"
};

function money(n) {
  const value = Number(n || 0);
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}g`;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

function api(path, options = {}) {
  if (!state.apiUrl) throw new Error("Set your Worker API URL first.");
  return fetch(`${state.apiUrl.replace(/\/$/, "")}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    return data;
  });
}

function parseBlockList(raw) {
  return raw.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map((rawLine) => {
      const match = rawLine.match(/^(.*?)\s*(?:\[([^\]]+)\])?$/);
      const name = (match?.[1] || rawLine).trim();
      const meta_codes = (match?.[2] || "").trim();
      return {
        name,
        raw_line: rawLine,
        meta_codes,
        category: inferCategory(name, meta_codes),
        is_internal: /INTERNAL|UNUSED|placeholder|Reserved|^_|temp/i.test(name) ? 1 : 0,
        is_placeholder: /placeholder|UNUSED|Reserved|temp/i.test(name) ? 1 : 0,
        is_tradeable: /INTERNAL|UNUSED|placeholder|Reserved|^_|temp/i.test(name) ? 0 : 1
      };
    });
}

function inferCategory(name, meta) {
  const n = name.toLowerCase();
  if (n.includes("ore") || n.includes("block of") || n.includes("moonstone") || n.includes("diamond") || n.includes("iron") || n.includes("gold") || n.includes("coal") || n.includes("emerald") || n.includes("lapis")) return "Ore / Valuable";
  if (n.includes("log") || n.includes("planks") || n.includes("sapling") || n.includes("leaves") || n.includes("barkless")) return "Wood / Tree";
  if (n.includes("door") || n.includes("trapdoor")) return "Door / Trapdoor";
  if (n.includes("slab")) return "Slab";
  if (n.includes("glass")) return "Glass";
  if (n.includes("wool") || n.includes("carpet")) return "Wool / Carpet";
  if (n.includes("concrete") || n.includes("clay") || n.includes("ceramic") || n.includes("chalk")) return "Colour / Building";
  if (n.includes("seed") || n.includes("plant") || n.includes("wheat") || n.includes("rice") || n.includes("corn") || n.includes("pumpkin") || n.includes("melon") || n.includes("carrot") || n.includes("potato") || n.includes("beetroot")) return "Crop / Food";
  if (n.includes("spawner")) return "Spawner";
  if (n.includes("banner")) return "Banner";
  if (n.includes("statue") || n.includes("trophy") || n.includes("pod")) return "Decorative";
  if (n.includes("torch") || n.includes("neon") || n.includes("light")) return "Light";
  if (n.includes("lucky") || n.includes("mystery")) return "Lucky / Mystery";
  if (n.includes("spawn block") || n.includes("checkpoint") || n.includes("goal") || n.includes("portal")) return "Game Block";
  if (n.includes("bed")) return "Bed";
  if (n.includes("stone") || n.includes("bricks") || n.includes("sandstone") || n.includes("granite") || n.includes("diorite") || n.includes("andesite")) return "Stone / Brick";
  return "Other";
}

const demoBlocks = [
  "Dirt [GR]", "Grass Block", "Stone", "Coal Ore", "Iron Ore", "Gold Ore", "Diamond Ore",
  "Block of Diamond", "Maple Door [O,R]", "_Maple Door Top [O,R]", "Stone Slab [H,R]",
  "Wheat [FG]", "Chest [R]", "Protector", "Lucky Block", "Ultra Lucky Block",
  "Moonstone Ore", "Block of Moonstone", "Diamond Trophy [R]", "67 Statue", "Torch [H,R]"
].join("\n");

async function loadAll() {
  try {
    const [items, trades, summary, inventory, history] = await Promise.all([
      api("/api/items?limit=3000"),
      api("/api/trades?limit=200"),
      api("/api/stats/summary"),
      api("/api/inventory"),
      api("/api/history/blocks")
    ]);
    state.items = items.items || [];
    state.trades = trades.trades || [];
    state.summary = summary;
    state.inventory = inventory.inventory || [];
    state.history = history.history || [];
    render();
  } catch (e) {
    toast(e.message);
  }
}

function render() {
  renderStats();
  renderRecent();
  renderHistory();
  renderInventory();
  renderBlocks();
  updatePreview();
}

function renderStats() {
  const s = state.summary || {};
  $("statProfit").textContent = money(s.realized_profit);
  $("statProfit").className = Number(s.realized_profit || 0) >= 0 ? "positive" : "negative";
  $("statRoi").textContent = `${Number(s.roi || 0).toFixed(1)}% ROI`;
  $("statSpent").textContent = money(s.spent);
  $("statRevenue").textContent = money(s.revenue);
  $("statInventory").textContent = state.inventory.length;
}

function renderRecent() {
  const q = ($("recentSearch").value || "").toLowerCase();
  const rows = state.trades.filter(t => {
    return `${t.item_name} ${t.trade_type} ${t.notes || ""}`.toLowerCase().includes(q);
  });
  $("recentBody").innerHTML = rows.map(t => {
    const cash = Number(t.cashflow || 0);
    return `<tr>
      <td>${new Date(t.created_at).toLocaleString()}</td>
      <td><span class="badge ${t.trade_type.startsWith("BUY") ? "buy" : "sell"}">${tradeLabels[t.trade_type] || t.trade_type}</span></td>
      <td><strong>${escapeHtml(t.item_name)}</strong><br><small class="neutral">${escapeHtml(t.category || "")}${t.meta_codes ? " • meta: " + escapeHtml(t.meta_codes) : ""}</small></td>
      <td class="right">${t.quantity}</td>
      <td class="right">${money(t.unit_price)}</td>
      <td class="right">${money(t.fee)}</td>
      <td class="right ${cash >= 0 ? "positive" : "negative"}">${cash >= 0 ? "+" : ""}${money(cash)}</td>
      <td>${escapeHtml(t.notes || "")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="neutral">No transactions yet.</td></tr>`;
}

function renderHistory() {
  const q = ($("historySearch").value || "").toLowerCase();
  const rows = state.history.filter(x => x.item_name.toLowerCase().includes(q));
  $("historyBody").innerHTML = rows.map(x => {
    const pl = Number(x.realized_profit || 0);
    return `<tr>
      <td><strong>${escapeHtml(x.item_name)}</strong><br><small class="neutral">${escapeHtml(x.category || "")}</small></td>
      <td class="right">${Number(x.bought_qty || 0)}</td>
      <td class="right">${Number(x.sold_qty || 0)}</td>
      <td class="right">${Number(x.holding_qty || 0)}</td>
      <td class="right">${money(x.avg_buy)}</td>
      <td class="right">${money(x.avg_sell)}</td>
      <td class="right ${pl >= 0 ? "positive" : "negative"}">${pl >= 0 ? "+" : ""}${money(pl)}</td>
      <td class="right">${Number(x.roi || 0).toFixed(1)}%</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="neutral">No block history yet.</td></tr>`;
}

function renderInventory() {
  $("inventoryBody").innerHTML = state.inventory.map(x => {
    const qty = Number(x.quantity || 0);
    return `<tr>
      <td><strong>${escapeHtml(x.item_name)}</strong><br><small class="neutral">${escapeHtml(x.category || "")}</small></td>
      <td class="right">${qty}</td>
      <td class="right">${money(x.avg_cost)}</td>
      <td class="right">${money(x.cost_basis)}</td>
      <td>${qty > 0 ? "Holding stock" : "Oversold / missing buy entry"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="neutral">No inventory yet.</td></tr>`;
}

function renderBlocks() {
  const q = ($("blockSearch").value || "").toLowerCase();
  const rows = state.items.filter(x => `${x.name} ${x.category} ${x.meta_codes}`.toLowerCase().includes(q)).slice(0, 300);
  $("blockGrid").innerHTML = rows.map(x => `<div class="block-card">
    <strong title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</strong>
    <small>${escapeHtml(x.category || "Other")}</small>
    <small>${x.meta_codes ? "Meta: " + escapeHtml(x.meta_codes) : "Root block"}</small>
  </div>`).join("") || `<p class="neutral">No blocks found.</p>`;
}

function updatePreview() {
  const type = state.selectedTradeType;
  const qty = Number($("qty").value || 0);
  const unit = Number($("unitPrice").value || 0);
  const fee = Number($("fee").value || 0);
  const value = qty * unit;
  const cash = type.startsWith("BUY") ? -(value + fee) : (value - fee);
  $("cashPreview").textContent = `${cash >= 0 ? "+" : ""}${money(cash)}`;
  $("cashPreview").className = cash >= 0 ? "positive" : "negative";
  $("inventoryPreview").textContent = `${type.startsWith("BUY") ? "+" : "-"}${qty} item${qty === 1 ? "" : "s"}`;
  $("inventoryPreview").className = type.startsWith("BUY") ? "positive" : "negative";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

async function searchItems() {
  const q = $("itemSearch").value.trim();
  if (!q) {
    $("itemResults").style.display = "none";
    return;
  }
  try {
    const data = await api(`/api/items?search=${encodeURIComponent(q)}&limit=80`);
    const items = data.items || [];
    $("itemResults").innerHTML = items.map(x => `<div class="item-option" data-id="${x.id}" data-name="${escapeHtml(x.name)}">
      <strong>${escapeHtml(x.name)}</strong>
      <small>${escapeHtml(x.category || "Other")}${x.meta_codes ? " • meta: " + escapeHtml(x.meta_codes) : " • root block"}</small>
    </div>`).join("") || `<div class="item-option"><small>No match. Import your full block list in Settings.</small></div>`;
    $("itemResults").style.display = "block";
    document.querySelectorAll(".item-option[data-id]").forEach(el => {
      el.addEventListener("click", () => {
        $("selectedItemId").value = el.dataset.id;
        $("itemSearch").value = el.dataset.name;
        $("itemResults").style.display = "none";
      });
    });
  } catch (e) {
    toast(e.message);
  }
}

function setupEvents() {
  $("apiUrl").value = state.apiUrl;
  $("saveApiBtn").addEventListener("click", () => {
    state.apiUrl = $("apiUrl").value.trim();
    localStorage.setItem("bloxd_api_url", state.apiUrl);
    toast("API URL saved.");
    loadAll();
  });

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.add("active");
    });
  });

  document.querySelectorAll(".trade-action").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".trade-action").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      state.selectedTradeType = btn.dataset.type;
      $("selectedTradeType").textContent = tradeLabels[state.selectedTradeType];
      $("tradeBadge").textContent = state.selectedTradeType;
      $("tradeBadge").className = `badge ${state.selectedTradeType.startsWith("BUY") ? "buy" : "sell"}`;
      updatePreview();
    });
  });
  document.querySelector(".trade-action[data-type='BUY_ORDER']").classList.add("active");

  ["qty", "unitPrice", "fee"].forEach(id => $(id).addEventListener("input", updatePreview));
  $("itemSearch").addEventListener("input", debounce(searchItems, 180));
  $("recentSearch").addEventListener("input", renderRecent);
  $("historySearch").addEventListener("input", renderHistory);
  $("blockSearch").addEventListener("input", renderBlocks);

  $("saveTradeBtn").addEventListener("click", async () => {
    try {
      const itemId = Number($("selectedItemId").value);
      if (!itemId) throw new Error("Pick a block/item from the search list first.");
      await api("/api/trades", {
        method: "POST",
        body: JSON.stringify({
          item_id: itemId,
          trade_type: state.selectedTradeType,
          quantity: Number($("qty").value || 0),
          unit_price: Number($("unitPrice").value || 0),
          fee: Number($("fee").value || 0),
          notes: $("notes").value || ""
        })
      });
      toast("Trade saved. Profit brain updated.");
      $("unitPrice").value = "";
      $("fee").value = "0";
      $("notes").value = "";
      await loadAll();
    } catch (e) {
      toast(e.message);
    }
  });

  $("importBlocksBtn").addEventListener("click", async () => {
    try {
      const blocks = parseBlockList($("seedText").value);
      if (!blocks.length) throw new Error("Paste your block list first.");
      await api("/api/items/import", { method: "POST", body: JSON.stringify({ items: blocks }) });
      toast(`Imported ${blocks.length} blocks.`);
      await loadAll();
    } catch (e) {
      toast(e.message);
    }
  });

  $("demoSeedBtn").addEventListener("click", () => {
    $("seedText").value = demoBlocks;
    toast("Demo block list inserted. Click Import Blocks to D1.");
  });

  $("refreshBtn").addEventListener("click", loadAll);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

setupEvents();
if (state.apiUrl) loadAll();
