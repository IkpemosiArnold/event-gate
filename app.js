import { runGate, audit, scrubAll, HASH_FIELDS, PASS_FIELDS, DAY } from "./check.js";
import { CLOCK, browserEvents, serverEvents, handBatch } from "./samples.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
};
const status = (ok, words = ["Sent", "Held"]) => {
  const s = el("span", `st ${ok ? "sent" : "held"}`);
  s.append(icon(ok ? "check" : "cross"), ok ? words[0] : words[1]);
  return s;
};

const ago = (t) => {
  const s = CLOCK - t;
  if (s >= DAY) return `${Math.round(s / DAY)} days ago`;
  if (s >= 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 60)} min ago`;
};

/** Pixel names for browser events, Conversions API names for server events. */
const browserKey = (p) => p.replace(/^event_name$/, "event").replace(/^event_id$/, "eventID").replace(/^event_source_url$/, "url").replace(/^custom_data\./, "");

function flat(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === "channel") continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flat(v, p));
    else out.push([p, Array.isArray(v) ? JSON.stringify(v) : v]);
  }
  return out;
}

const shortHash = (h) => `${h.slice(0, 10)}…${h.slice(-4)}`;

function kvBlock(title, pairs, { keyName, lineClass, valueNode }) {
  const wrap = el("div", "blk");
  wrap.append(el("p", "blk-h", title));
  const box = el("div", "kv");
  for (const [p, v] of pairs) {
    const ln = el("div", `ln ${lineClass(p) || ""}`);
    ln.append(el("span", "k", keyName(p)), " ");
    const val = el("span", "v");
    val.append(valueNode(p, v));
    ln.append(val);
    box.append(ln);
  }
  wrap.append(box);
  return wrap;
}

/** A URL with the removed parts underlined in red. */
function urlNode(url, parts) {
  const frag = document.createDocumentFragment();
  const marks = parts
    .map((part) => ({ part, at: url.indexOf(part) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  let at = 0;
  for (const m of marks) {
    if (m.at < at) continue;
    frag.append(url.slice(at, m.at), el("span", "u fail", m.part));
    at = m.at + m.part.length;
  }
  frag.append(url.slice(at));
  return frag;
}

function uaNode(v) {
  const s = el("span", null, `${String(v).slice(0, 26)}…`);
  s.title = String(v);
  return s;
}

function timeText(v) {
  return typeof v === "number" ? `${v} (${ago(v)})` : String(v);
}

function partView(name, part, opts) {
  const { raw, out, changes, audit: a } = part;
  const isBrowser = name === "Browser pixel";
  const keyName = isBrowser ? browserKey : (p) => p;
  const removedFields = changes.filter((c) => c.kind === "removed" && c.field !== "event_source_url").map((c) => c.field);
  const urlParts = changes.filter((c) => c.field === "event_source_url").map((c) => c.part);

  const box = el("div", "part");
  const h = el("p", "part-h", name);
  h.append(el("span", `tag ${a.ok ? "" : "held"}`, a.ok ? (opts.sentWhen || "sent") : "held, not sent"));
  box.append(h);

  const cols = el("div", "pair-cols");
  cols.append(kvBlock("Received", flat(raw), {
    keyName,
    lineClass: (p) => (removedFields.some((f) => p === f || p.startsWith(`${f}.`)) ? "gone" : ""),
    valueNode: (p, v) => {
      if (p === "event_source_url") return urlNode(String(v), urlParts);
      if (p === "event_time") return document.createTextNode(timeText(v));
      if (p.endsWith("client_user_agent")) return uaNode(v);
      if (v === "") return document.createTextNode('""');
      return document.createTextNode(String(v));
    },
  }));
  if (a.ok) {
    cols.append(kvBlock("Sent to Meta", flat(out), {
      keyName,
      lineClass: (p) => (HASH_FIELDS.includes(p.replace("user_data.", "")) && p.startsWith("user_data.") ? "hashed" : ""),
      valueNode: (p, v) => {
        if (p === "event_time") return document.createTextNode(timeText(v));
        if (p.endsWith("client_user_agent")) return uaNode(v);
        if (p.startsWith("user_data.") && HASH_FIELDS.includes(p.slice(10))) {
          const s = el("span", null, shortHash(String(v)));
          s.title = String(v);
          return s;
        }
        return document.createTextNode(v === "" ? '""' : String(v));
      },
    }));
  } else {
    const held = el("div", "blk");
    held.append(el("p", "blk-h", "Sent to Meta"));
    for (const r of a.reasons) {
      const p = el("p", "held-out", r.text);
      if (r.fix) p.append(" ", el("span", "fix", r.fix));
      held.append(p);
    }
    cols.append(held);
  }
  box.append(cols);

  const list = el("ul", "changes");
  for (const c of changes.filter((c) => c.kind === "removed")) {
    const li = el("li");
    const what = c.field === "event_source_url" ? c.part : keyName(c.field);
    li.append("Removed ", el("b", null, what), c.field === "event_source_url" ? " from the URL: " : ": ");
    li.append(el("span", c.why.startsWith("health") ? "h" : null, c.why));
    list.append(li);
  }
  const hashed = changes.filter((c) => c.kind === "hashed");
  if (hashed.length) {
    const li = el("li");
    const em = hashed.find((c) => c.field === "user_data.em");
    li.append("Hashed ", el("b", null, [...new Set(hashed.map((c) => c.field.slice(10)))].join(", ")), " with SHA-256 after normalising");
    if (em) li.append(` (the email became ${em.normalised})`);
    list.append(li);
  }
  const passed = Object.keys(out.user_data || {}).filter((k) => PASS_FIELDS.includes(k));
  if (passed.length && a.ok) {
    const li = el("li");
    li.append("Sent as they are, as Meta asks: ", el("b", null, passed.join(", ")));
    list.append(li);
  }
  if (list.children.length) box.append(list);
  return box;
}

function evidence(row) {
  const ev = el("div", "ev");
  if (row.kind === "pair") {
    ev.append(el("p", "ev-note", `Same event_name and event_id, ${row.server.out.event_id}, within 48 hours. Meta keeps one copy, generally the first it receives, and drops the other.`));
  }
  if (row.browser) {
    const older = CLOCK - row.browser.out.event_time > DAY;
    ev.append(partView("Browser pixel", row.browser, { sentWhen: older ? `sent ${ago(row.browser.out.event_time)}` : "sent" }));
  }
  if (row.server) ev.append(partView("Server, Conversions API", row.server, {}));
  return ev;
}

function rowMeta(row) {
  if (row.status === "held") {
    const m = el("span", "meta why", row.reasons[0].text);
    if (row.reasons[0].fix) m.append(" ", el("span", "fix", row.reasons[0].fix));
    return m;
  }
  const changes = [...(row.browser ? row.browser.changes : []), ...(row.server ? row.server.changes : [])];
  const health = changes.filter((c) => c.kind === "removed" && c.why.startsWith("health")).length;
  const base = row.kind === "pair" ? "Browser and server, counted once" : row.kind === "browser" ? "Browser only" : "Server only";
  return el("span", "meta", health ? `${base}. ${health} health detail${health === 1 ? "" : "s"} removed.` : `${base}.`);
}

let openItem = null;
function toggle(item, row, btn) {
  const isOpen = btn.getAttribute("aria-expanded") === "true";
  if (openItem && openItem.item !== item) {
    openItem.btn.setAttribute("aria-expanded", "false");
    openItem.panel.remove();
    openItem = null;
  }
  if (isOpen) {
    btn.setAttribute("aria-expanded", "false");
    if (openItem) openItem.panel.remove();
    openItem = null;
    return;
  }
  const panel = evidence(row);
  panel.id = `ev-${btn.id}`;
  btn.setAttribute("aria-controls", panel.id);
  item.append(panel);
  btn.setAttribute("aria-expanded", "true");
  openItem = { item, btn, panel };
}

function renderGate({ rows, summary }) {
  const sum = $("summary");
  sum.replaceChildren(el("span", "sum-main", `${summary.sent} sent,`), el("span", "sum-side", `${summary.held} held back`));
  $("sum-line").replaceChildren(
    `${summary.healthRemoved} health details removed, such as `,
    el("span", "u fail", "condition=type-2-diabetes"),
    ` in an intake URL. ${summary.hashed} fields hashed, ${summary.pairs} browser and server pairs counted once.`,
  );

  const groups = $("groups");
  groups.replaceChildren();
  const make = (title, list) => {
    if (!list.length) return;
    const g = el("div", "group");
    g.append(el("p", "group-h", title));
    const wrap = el("div", "rows");
    list.forEach((row, i) => {
      const item = el("div", "row-item");
      const btn = el("button", "row");
      btn.type = "button";
      btn.id = `r-${title.replace(/\W+/g, "")}-${i}`;
      btn.setAttribute("aria-expanded", "false");
      const body = el("span", "body");
      body.append(el("span", "title", row.label), rowMeta(row));
      const chev = icon("chev");
      chev.classList.add("chev");
      btn.append(status(row.status === "sent"), body, chev);
      btn.addEventListener("click", () => toggle(item, row, btn));
      item.append(btn);
      wrap.append(item);
      if (row.label === "Lead, intake form" && row.status === "sent") requestAnimationFrame(() => toggle(item, row, btn));
    });
    g.append(wrap);
    groups.append(g);
  };
  make("Held back", rows.filter((r) => r.status === "held"));
  make("Sent", rows.filter((r) => r.status === "sent"));
}

// Second panel
let browserLog = [];
let handMode = "raw";

function renderHand(events, mode, animate, before = null) {
  const results = audit(events, browserLog, CLOCK);
  const blocked = results.filter((r) => !r.ok).length;
  const sum = $("hand-summary");
  const main = el("span", "sum-main", `${blocked} of ${events.length} blocked`);
  if (blocked) main.style.color = "var(--fail)";
  sum.replaceChildren(main);
  $("hand-line").textContent = mode === "gated"
    ? "After the gate: the email is hashed, the URL path and the product name are gone. It will not invent an event_name or rewrite an event_id on an order-number match, so those wait for a person."
    : mode === "gated-own"
      ? "After the gate. What it can fix safely is fixed. The rest waits for a person."
      : mode === "edited"
      ? "Checked as written, without the gate."
      : "Checked as written, without the gate. The same check runs last inside the gate.";

  const wrap = $("hand-rows");
  wrap.replaceChildren();
  results.forEach((r, i) => {
    const e = events[i];
    const item = el("div", `row-item${animate ? " in" : ""}`);
    if (animate) item.style.animationDelay = `${Math.min(i, 5) * 40}ms`;
    const row = el("div", "row static");
    const body = el("span", "body");
    body.append(el("span", "title", `${e.event_name || "No event_name"}, ${e.event_id ?? "no event_id"}`));
    const fixed = before && before[i] && !before[i].ok;
    if (r.ok) body.append(el("span", "meta", fixed ? `Fixed by the gate. Was: ${before[i].reasons[0].text}` : r.pair ? "Pairs with the browser copy, counted once." : "Clean."));
    for (const x of r.reasons) {
      const m = el("span", "meta why", x.text);
      if (x.fix) m.append(" ", el("span", "fix", x.fix));
      body.append(m);
    }
    row.append(status(r.ok, ["Pass", "Blocked"]), body);
    item.append(row);
    wrap.append(item);
  });
}

function readBox() {
  const err = $("hand-error");
  err.hidden = true;
  try {
    let v = JSON.parse($("hand-in").value);
    if (v && Array.isArray(v.data)) v = v.data;
    if (!Array.isArray(v) || !v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      throw new Error("Expected an array of events, or an object with a data array.");
    }
    return v;
  } catch (e) {
    err.textContent = e.message.startsWith("Expected an array") ? e.message : `That JSON did not parse: ${e.message}`;
    err.hidden = false;
    return null;
  }
}

async function main() {
  const gate = await runGate(browserEvents, serverEvents, CLOCK);
  browserLog = gate.browserLog;
  renderGate(gate);

  $("hand-in").value = JSON.stringify(handBatch, null, 2);
  renderHand(handBatch, "raw", false);

  $("hand-gate").addEventListener("click", async () => {
    const events = $("hand-box").hidden ? handBatch : readBox();
    if (!events) return;
    handMode = $("hand-box").hidden ? "gated" : "gated-own";
    renderHand(await scrubAll(events), handMode, true, audit(events, browserLog, CLOCK));
    $("hand-reset").hidden = false;
  });
  $("hand-check").addEventListener("click", () => {
    const events = readBox();
    if (!events) return;
    handMode = "edited";
    renderHand(events, "edited", true);
    $("hand-reset").hidden = false;
  });
  $("hand-reset").addEventListener("click", () => {
    $("hand-in").value = JSON.stringify(handBatch, null, 2);
    $("hand-error").hidden = true;
    handMode = "raw";
    renderHand(handBatch, "raw", true);
    $("hand-reset").hidden = true;
  });
  $("hand-edit").addEventListener("click", (ev) => {
    const box = $("hand-box");
    box.hidden = !box.hidden;
    ev.currentTarget.setAttribute("aria-expanded", String(!box.hidden));
    ev.currentTarget.textContent = box.hidden ? "Edit the JSON" : "Hide the JSON";
  });
}

main();
