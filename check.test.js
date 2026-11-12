import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  runGate, audit, scrubAll, scrubEvent, scrubUrl, findHealthTerms, normalise,
  HASH_FIELDS, DAY,
} from "./check.js";
import { CLOCK, browserEvents, serverEvents, handBatch } from "./samples.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;

test("the sample: 13 events, 9 sent, 4 held back, 2 pairs counted once", async () => {
  const { summary, rows } = await runGate(browserEvents, serverEvents, CLOCK);
  assert.equal(summary.events, 13);
  assert.equal(summary.sent, 9);
  assert.equal(summary.held, 4);
  assert.equal(summary.pairs, 2);
  const held = rows.filter((r) => r.status === "held").map((r) => [r.label, r.reasons.map((x) => x.code)]);
  assert.deepEqual(held, [
    ["Purchase, order 1043", ["id_mismatch"]],
    ["Purchase, order 1039, replayed", ["replay_after_48h"]],
    ["Purchase, order 0987, replayed", ["stale_time"]],
    ["Consult booked", ["no_event_name"]],
  ]);
});

test("nothing that leaves carries a health term or an unhashed identity field", async () => {
  const { rows } = await runGate(browserEvents, serverEvents, CLOCK);
  for (const r of rows) {
    for (const part of [r.browser, r.server]) {
      if (!part) continue;
      const out = part.out;
      const { user_data: ud = {}, ...rest } = out;
      assert.deepEqual(findHealthTerms(JSON.stringify(rest)), [], `${r.label}: ${JSON.stringify(rest)}`);
      for (const k of HASH_FIELDS) if (ud[k] != null) assert.match(ud[k], HEX64, `${r.label} ${k}`);
    }
  }
});

test("email and phone are normalised the way Meta asks before hashing", async () => {
  const { out, changes } = await scrubEvent(serverEvents[0].event);
  assert.equal(out.user_data.em, sha("dana.reyes@example.com"));
  assert.equal(out.user_data.ph, sha("14155550188"));
  assert.equal(out.user_data.fn, sha("dana"));
  assert.equal(out.user_data.country, sha("us"));
  assert.ok(changes.some((c) => c.kind === "hashed" && c.field === "user_data.em"));
});

test("IP, user agent, fbp and fbc pass through unhashed", async () => {
  const raw = serverEvents[0].event.user_data;
  const { out } = await scrubEvent(serverEvents[0].event);
  for (const k of ["client_ip_address", "client_user_agent", "fbp", "fbc"]) assert.equal(out.user_data[k], raw[k]);
});

test("an existing SHA-256 hash is not hashed twice", async () => {
  const h = sha("someone@example.com");
  const { out } = await scrubEvent({ event_name: "Lead", user_data: { em: h } });
  assert.equal(out.user_data.em, h);
});

test("URLs keep the origin and clean allowed params only", () => {
  const r = scrubUrl("https://brightpath.example/weight-loss/semaglutide?utm_source=meta&utm_campaign=glp1_nov&fbclid=IwAR2&ref=x");
  assert.equal(r.url, "https://brightpath.example/?utm_source=meta&fbclid=IwAR2");
  assert.deepEqual(r.removed.map((x) => x.part), ["/weight-loss/semaglutide", "utm_campaign=glp1_nov", "ref=x"]);
  assert.equal(scrubUrl("https://brightpath.example/intake?step=3&condition=type-2-diabetes").url, "https://brightpath.example/intake");
});

test("health terms match whole words across separators, not inside other words", () => {
  assert.deepEqual(findHealthTerms("ozempic+alternative"), ["ozempic"]);
  assert.deepEqual(findHealthTerms("glp-1 plan"), ["glp 1"]);
  assert.deepEqual(findHealthTerms("Hair_Loss%20kit"), ["hair loss"]);
  assert.deepEqual(findHealthTerms("strtx country"), []);
});

test("free-text form answers never leave", async () => {
  const { out, changes } = await scrubEvent(serverEvents[0].event);
  assert.equal(out.custom_data.form_answers, undefined);
  assert.ok(changes.some((c) => c.field === "custom_data.form_answers" && c.why.includes("metformin")));
});

test("dedup: same event_name and event_id within 48 hours is a pair", async () => {
  const { rows } = await runGate(browserEvents, serverEvents, CLOCK);
  const lead = rows.find((r) => r.label === "Lead, intake form");
  assert.equal(lead.kind, "pair");
  assert.equal(lead.server.audit.pair.browser.event_id, "lead_5531");
});

test("dedup: a copy after 48 hours is held, one inside is not", () => {
  const log = [{ channel: "browser", event_name: "Purchase", event_id: "ord_1", event_time: CLOCK - 47 * 3600 }];
  const ev = { event_name: "Purchase", event_id: "ord_1", event_time: CLOCK - 47 * 3600, action_source: "website", event_source_url: "https://a.example/", user_data: { client_user_agent: "test" } };
  assert.equal(audit([ev], log, CLOCK)[0].ok, true);
  const old = [{ ...log[0], event_time: CLOCK - 49 * 3600 }];
  assert.equal(audit([{ ...ev, event_time: CLOCK - 49 * 3600 }], old, CLOCK)[0].reasons[0].code, "replay_after_48h");
});

test("event_time: 7 days passes, a minute more is held", () => {
  const base = { event_name: "Purchase", event_id: "x", action_source: "website", event_source_url: "https://a.example/", user_data: { client_user_agent: "test" } };
  assert.equal(audit([{ ...base, event_time: CLOCK - 7 * DAY }], [], CLOCK)[0].ok, true);
  assert.equal(audit([{ ...base, event_time: CLOCK - 7 * DAY - 60 }], [], CLOCK)[0].reasons[0].code, "stale_time");
  assert.equal(audit([{ ...base, event_time: undefined }], [], CLOCK)[0].reasons[0].code, "no_event_time");
});

test("a retry in the same batch is held", () => {
  const ev = { event_name: "Lead", event_id: "l1", event_time: CLOCK - 60, action_source: "website", event_source_url: "https://a.example/", user_data: { client_user_agent: "test" } };
  const res = audit([ev, { ...ev }], [], CLOCK);
  assert.equal(res[0].ok, true);
  assert.equal(res[1].reasons[0].code, "dup_in_batch");
});

test("the hand-built batch: all six planted mistakes blocked, two clean events pass", async () => {
  const { browserLog } = await runGate(browserEvents, serverEvents, CLOCK);
  const res = audit(handBatch, browserLog, CLOCK).map((r) => (r.ok ? "ok" : r.reasons.map((x) => x.code).join(",")));
  assert.deepEqual(res, ["ok", "raw_pii", "health_term", "health_term", "id_mismatch", "no_event_name", "stale_time", "ok"]);
});

test("the hand-built batch through the gate: three fixed, three still held", async () => {
  const { browserLog } = await runGate(browserEvents, serverEvents, CLOCK);
  const res = audit(await scrubAll(handBatch), browserLog, CLOCK).map((r) => (r.ok ? "ok" : r.reasons[0].code));
  assert.deepEqual(res, ["ok", "ok", "ok", "ok", "id_mismatch", "no_event_name", "stale_time", "ok"]);
});

test("Meta's own worked examples hash to Meta's published SHA256 output", () => {
  const cases = [
    ["em", "John_Smith@gmail.com", "62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f"],
    ["ph", "1(650)555-1212", "e323ec626319ca94ee8bff2e4c87cf613be6ea19919ed1364124e16807ab3176"],
    ["fn", "Mary", "6915771be1c5aa0c886870b6951b03d7eafc121fea0e80a5ea83beb7c449f4ec"],
    ["fn", "\uC815", "8fa8cd9c440be61d0151429310034083132b35975c4bea67fdd74158eb51db14"],
    ["fn", "Val\u00e9ry", "08e1996b5dd49e62a4b4c010d44e4345592a863bb9f8e3976219bac29417149c"],
    ["country", "US", "79adb2a2fce5c6ba215fe5f27f532d4e7edbac4b6a5e09e1ef3a08084a904621"],
  ];
  for (const [field, input, want] of cases) assert.equal(sha(normalise(field, input)), want, `${field} ${input}`);
});

test("a field with nothing left after normalising is dropped, not hashed", async () => {
  const { out, changes } = await scrubEvent({ event_name: "Lead", user_data: { fn: "...", em: "a@b.example" } });
  assert.equal(out.user_data.fn, undefined);
  assert.ok(changes.some((c) => c.field === "user_data.fn" && c.why === "nothing left to hash"));
});

test("a website event with no client_user_agent is held", () => {
  const ev = { event_name: "Lead", event_id: "l2", event_time: CLOCK - 60, action_source: "website", event_source_url: "https://a.example/", user_data: {} };
  assert.deepEqual(audit([ev], [], CLOCK)[0].reasons.map((x) => x.code), ["no_user_agent"]);
});
