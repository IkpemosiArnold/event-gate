// Event Gate: clean, hash and match ad events before they leave for Meta.
// Plain code, no model. Runs the same in the browser and in Node 20+.
//
// Meta rules used here (see README for links and quotes):
// - Dedup: a browser event's eventID must match the server event's event_id,
//   and event must match event_name. Meta discards the later copy only if it
//   arrives within 48 hours of the first one with that event_id.
// - event_time is a Unix timestamp in seconds, at most 7 days before sending.
//   One older event and Meta rejects the whole request.
// - em, ph, fn, ln, db, ge, ct, st, zp and country must be hashed (SHA-256 in
//   Meta's examples) after normalising; external_id should be.
//   client_ip_address, client_user_agent, fbc and fbp must not be hashed.

export const DAY = 86400;
export const DEDUP_WINDOW = 2 * DAY;
export const MAX_AGE = 7 * DAY;

// A sample list. A real one would be maintained per client and backed by a
// classifier for new brand names and misspellings.
export const HEALTH_TERMS = [
  "semaglutide", "tirzepatide", "ozempic", "wegovy", "mounjaro", "zepbound", "rybelsus",
  "glp1", "glp 1", "metformin", "weight loss", "obesity", "diabetes", "bmi",
  "sildenafil", "tadalafil", "viagra", "cialis", "erectile dysfunction", "finasteride",
  "minoxidil", "hair loss", "testosterone", "trt", "estradiol", "progesterone", "hrt",
  "menopause", "pregnancy", "fertility", "ivf", "hiv", "depression", "anxiety", "adhd",
  "insomnia", "migraine", "mental health", "hormone therapy",
];

export const HASH_FIELDS = ["em", "ph", "fn", "ln", "db", "ge", "ct", "st", "zp", "country", "external_id"];
export const PASS_FIELDS = ["client_ip_address", "client_user_agent", "fbc", "fbp"];
export const URL_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid"];
export const CUSTOM_KEEP = ["value", "currency", "content_ids", "content_type", "num_items", "order_id"];
export const CUSTOM_SCAN = ["content_name", "content_category", "search_string"];

const HEX64 = /^[0-9a-f]{64}$/;

function decode(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch { return String(s); }
}

function flatText(s) {
  return " " + decode(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

/** Health terms found in a string, in list order. */
export function findHealthTerms(value) {
  if (value == null) return [];
  const text = flatText(typeof value === "string" ? value : JSON.stringify(value));
  return HEALTH_TERMS.filter((t) => text.includes(` ${t} `));
}

/** Meta's normalising before a hash. */
export function normalise(field, raw) {
  let v = String(raw).trim().toLowerCase();
  switch (field) {
    case "ph": return v.replace(/[^0-9]/g, "").replace(/^0+/, "");
    case "fn": case "ln": case "ct": return v.replace(/[^\p{L}\p{M}]/gu, "");
    case "zp": { const z = v.replace(/[\s-]/g, ""); return /^\d{9}$/.test(z) ? z.slice(0, 5) : z; }
    case "ge": return /^[fm]/.test(v) ? v[0] : v;
    case "st": case "country": return v.replace(/[^a-z]/g, "");
    case "db": return v.replace(/[^0-9]/g, "");
    default: return v;
  }
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keep the origin and the allowed, clean query params. A path with a health term goes. */
export function scrubUrl(raw) {
  const removed = [];
  let u;
  try { u = new URL(raw); } catch { return { url: raw, removed }; }
  const segs = u.pathname.split("/").filter(Boolean);
  const pathTerms = findHealthTerms(segs.join(" "));
  if (pathTerms.length) {
    removed.push({ part: u.pathname, why: `health term "${pathTerms[0]}"` });
    u.pathname = "/";
  }
  const kept = new URLSearchParams();
  for (const part of u.search.slice(1).split("&").filter(Boolean)) {
    const [[k, v] = ["", ""]] = [...new URLSearchParams(part)];
    const terms = findHealthTerms(`${k} ${v}`);
    if (terms.length) removed.push({ part, why: `health term "${terms[0]}"` });
    else if (!URL_PARAMS.includes(k)) removed.push({ part, why: "not on the allowlist" });
    else kept.append(k, v);
  }
  u.search = kept.toString();
  u.hash = "";
  return { url: u.toString(), removed };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Clean one event. Returns the event as it would be sent and a list of what changed.
 * Events use Conversions API names; browser events carry channel: "browser".
 */
export async function scrubEvent(event) {
  const out = clone(event);
  const changes = [];

  if (typeof out.event_source_url === "string") {
    const r = scrubUrl(out.event_source_url);
    for (const x of r.removed) changes.push({ kind: "removed", field: "event_source_url", part: x.part, why: x.why });
    out.event_source_url = r.url;
  }

  if (out.custom_data && typeof out.custom_data === "object") {
    const cd = {};
    for (const [k, v] of Object.entries(out.custom_data)) {
      const terms = findHealthTerms(v);
      const field = `custom_data.${k}`;
      if (terms.length) changes.push({ kind: "removed", field, part: v, why: `health term "${terms[0]}"` });
      else if (CUSTOM_KEEP.includes(k) || CUSTOM_SCAN.includes(k)) cd[k] = v;
      else changes.push({ kind: "removed", field, part: v, why: "not on the allowlist" });
    }
    out.custom_data = cd;
  }

  if (out.user_data && typeof out.user_data === "object") {
    const ud = {};
    for (const [k, v] of Object.entries(out.user_data)) {
      const field = `user_data.${k}`;
      if (HASH_FIELDS.includes(k)) {
        const vals = Array.isArray(v) ? v : [v];
        const hashed = [];
        for (const one of vals) {
          if (HEX64.test(String(one))) { hashed.push(String(one)); continue; }
          const n = normalise(k, one);
          if (!n) { changes.push({ kind: "removed", field, part: one, why: "nothing left to hash" }); continue; }
          hashed.push(await sha256Hex(n));
          changes.push({ kind: "hashed", field, part: one, normalised: n });
        }
        if (hashed.length) ud[k] = Array.isArray(v) ? hashed : hashed[0];
      } else if (PASS_FIELDS.includes(k)) {
        ud[k] = v;
      } else {
        changes.push({ kind: "removed", field, part: v, why: "not on the allowlist" });
      }
    }
    out.user_data = ud;
  }
  return { out, changes };
}

const orderOf = (e) => (e && e.custom_data && e.custom_data.order_id != null ? String(e.custom_data.order_id) : null);
const ago = (secs) => {
  const d = secs / DAY;
  if (d >= 1) return `${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`;
  const h = Math.round(secs / 3600);
  return `${h} hour${h === 1 ? "" : "s"}`;
};

/** Strings that would leave, minus user_data (hashes, IP, user agent, cookie IDs). */
function outgoingStrings(e, path = "") {
  const list = [];
  for (const [k, v] of Object.entries(e || {})) {
    const p = path ? `${path}.${k}` : k;
    if (p === "user_data" || p === "channel") continue;
    if (v && typeof v === "object") list.push(...outgoingStrings(v, p));
    else if (typeof v === "string") list.push([p, v]);
  }
  return list;
}

/**
 * The last check before anything leaves. It does not fix; it blocks with a reason.
 * browserLog: browser events Meta has already received, with event_time as receipt time.
 */
export function audit(events, browserLog, clock) {
  const seen = new Map();
  return events.map((e, i) => {
    const reasons = [];
    const server = e.channel !== "browser";
    let pair = null;

    if (!e.event_name || typeof e.event_name !== "string") {
      reasons.push({ code: "no_event_name", text: "No event_name. Meta needs a standard or custom name for every event." });
    }
    if (typeof e.event_time !== "number" || !Number.isFinite(e.event_time)) {
      reasons.push({ code: "no_event_time", text: "No event_time. Meta needs a Unix time in seconds." });
    } else if (clock - e.event_time > MAX_AGE) {
      reasons.push({ code: "stale_time", text: `event_time is ${ago(clock - e.event_time)} old. Past 7 days Meta rejects the whole request, not just this event.` });
    }
    if (server && !e.action_source) reasons.push({ code: "no_action_source", text: "No action_source. Meta needs one, such as website." });
    if (server && e.action_source === "website" && !e.event_source_url) {
      reasons.push({ code: "no_source_url", text: "No event_source_url. Meta needs it for website events." });
    }
    if (server && e.action_source === "website" && !(e.user_data && e.user_data.client_user_agent)) {
      reasons.push({ code: "no_user_agent", text: "No client_user_agent. Meta needs it for website events." });
    }

    for (const [k, v] of Object.entries(e.user_data || {})) {
      if (!HASH_FIELDS.includes(k)) continue;
      for (const one of Array.isArray(v) ? v : [v]) {
        if (!HEX64.test(String(one))) {
          const what = k === "em" ? "a raw email" : k === "ph" ? "a raw phone number" : "raw text";
          reasons.push({ code: "raw_pii", field: `user_data.${k}`, text: `user_data.${k} is ${what}, not a SHA-256 hash.` });
        }
      }
    }

    for (const [p, s] of outgoingStrings(e)) {
      const terms = findHealthTerms(s);
      if (terms.length) reasons.push({ code: "health_term", field: p, term: terms[0], text: `Health term "${terms[0]}" in ${p}.` });
    }

    if (server && e.event_name) {
      const key = `${e.event_name}|${e.event_id}`;
      if (e.event_id != null && seen.has(key)) {
        reasons.push({ code: "dup_in_batch", text: `Same event_name and event_id as event ${seen.get(key) + 1} in this batch. A retry should go once.` });
      } else if (e.event_id != null) seen.set(key, i);

      const match = browserLog.find((b) => b.event_name === e.event_name && b.event_id != null && b.event_id === e.event_id);
      if (match) {
        const gap = clock - match.event_time;
        if (gap <= DEDUP_WINDOW) pair = { browser: match, gap };
        else reasons.push({ code: "replay_after_48h", text: `The browser sent ${match.event_id} ${ago(gap)} ago. Meta only matches copies within 48 hours, so this would count twice.` });
      } else {
        const order = orderOf(e);
        const same = order && browserLog.find((b) => b.event_name === e.event_name && orderOf(b) === order);
        if (same) {
          reasons.push({
            code: "id_mismatch",
            text: `event_id ${e.event_id == null ? "is missing" : e.event_id} does not match the browser's ${same.event_id}, so Meta may count order ${order} twice.`,
            fix: `Send event_id ${same.event_id}.`,
          });
        }
      }
    }
    return { index: i, ok: reasons.length === 0, reasons, pair };
  });
}

/**
 * The whole gate: clean every event, then audit. Browser events are cleaned in
 * the tag before they fire; server events before the Conversions API call.
 */
export async function runGate(browserItems, serverItems, clock) {
  const browser = [];
  for (const item of browserItems) browser.push({ ...item, ...(await scrubEvent(item.event)) });
  const server = [];
  for (const item of serverItems) server.push({ ...item, ...(await scrubEvent(item.event)) });

  const browserLog = browser.map((b) => b.out);
  const bAudit = audit(browserLog, [], clock);
  const sAudit = audit(server.map((s) => s.out), browserLog, clock);

  const rows = [];
  const usedBrowser = new Set();
  server.forEach((s, i) => {
    const a = sAudit[i];
    let bi = -1;
    if (a.pair) bi = browserLog.indexOf(a.pair.browser);
    else {
      const ord = orderOf(s.out);
      bi = browserLog.findIndex((b) => b.event_name === s.out.event_name && ((b.event_id && b.event_id === s.out.event_id) || (ord && orderOf(b) === ord)));
    }
    const b = bi >= 0 ? browser[bi] : null;
    if (bi >= 0) usedBrowser.add(bi);
    rows.push({
      label: s.label,
      status: a.ok ? "sent" : "held",
      kind: b ? (a.ok ? "pair" : "pair-held") : "server",
      reasons: a.reasons,
      browser: b ? { raw: b.event, out: b.out, changes: b.changes, audit: bAudit[bi] } : null,
      server: { raw: s.event, out: s.out, changes: s.changes, audit: a },
    });
  });
  browser.forEach((b, i) => {
    if (usedBrowser.has(i)) return;
    rows.push({
      label: b.label,
      status: bAudit[i].ok ? "sent" : "held",
      kind: "browser",
      reasons: bAudit[i].reasons,
      browser: { raw: b.event, out: b.out, changes: b.changes, audit: bAudit[i] },
      server: null,
    });
  });

  const count = (pred) => rows.reduce((n, r) => n + pred(r), 0);
  const changes = [...browser, ...server].flatMap((x) => x.changes);
  const summary = {
    events: browser.length + server.length,
    sent: count((r) => (r.browser && r.browser.audit.ok ? 1 : 0) + (r.server && r.server.audit.ok ? 1 : 0)),
    held: count((r) => (r.browser && !r.browser.audit.ok ? 1 : 0) + (r.server && !r.server.audit.ok ? 1 : 0)),
    pairs: count((r) => (r.kind === "pair" ? 1 : 0)),
    healthRemoved: changes.filter((c) => c.kind === "removed" && c.why.startsWith("health")).length,
    otherRemoved: changes.filter((c) => c.kind === "removed" && !c.why.startsWith("health")).length,
    hashed: changes.filter((c) => c.kind === "hashed").length,
  };
  return { rows, summary, browserLog };
}

/** Clean a hand-built batch, for "Run it through the gate". */
export async function scrubAll(events) {
  const out = [];
  for (const e of events) out.push((await scrubEvent(e)).out);
  return out;
}
