// Sample data only. A made-up telehealth clinic on a reserved .example domain,
// made-up people, made-up orders. No real events, no real customers.

export const CLOCK = 1794474000; // 12 Nov 2026, 09:00 GMT, the sample "now"
const MIN = 60;
const DAY = 86400;
const SITE = "https://brightpath.example";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const FBP = "fb.1.1794470000123.1188442211";
const FBC = "fb.1.1794470880000.IwAR2xY7kQ";

const dana = {
  em: " Dana.Reyes@Example.com ",
  ph: "+1 (415) 555-0188",
  fn: "Dana",
  ln: "Reyes",
  zp: "94110",
  country: "US",
  fbp: FBP,
  fbc: FBC,
  client_ip_address: "203.0.113.24",
  client_user_agent: UA,
};
const sam = {
  em: "sam.lee@example.com",
  ph: "+1 646 555 0142",
  fbp: "fb.1.1794469100456.5521098834",
  client_ip_address: "198.51.100.7",
  client_user_agent: UA,
};

/** What the browser pixel fires, in Conversions API names (the pixel calls them event and eventID). */
export const browserEvents = [
  {
    label: "Page view, landing page",
    event: {
      channel: "browser", event_name: "PageView", event_id: "pv_7f3a", event_time: CLOCK - 52 * MIN,
      event_source_url: `${SITE}/weight-loss/semaglutide?utm_source=meta&utm_campaign=glp1_nov&fbclid=IwAR2xY7kQ`,
    },
  },
  {
    label: "Product view",
    event: {
      channel: "browser", event_name: "ViewContent", event_id: "vc_9b21", event_time: CLOCK - 48 * MIN,
      event_source_url: `${SITE}/products/starter-kit?variant=0-25mg`,
      custom_data: { content_name: "Semaglutide Starter Kit 0.25mg", content_ids: ["sku_118"], content_type: "product", value: 199, currency: "USD" },
    },
  },
  {
    label: "Site search",
    event: {
      channel: "browser", event_name: "Search", event_id: "se_44c0", event_time: CLOCK - 45 * MIN,
      event_source_url: `${SITE}/search?q=ozempic+alternative`,
      custom_data: { search_string: "ozempic alternative" },
    },
  },
  {
    label: "Lead, intake form",
    event: {
      channel: "browser", event_name: "Lead", event_id: "lead_5531", event_time: CLOCK - 40 * MIN,
      event_source_url: `${SITE}/intake?step=3&condition=type-2-diabetes`,
    },
  },
  {
    label: "Purchase, order 1042",
    event: {
      channel: "browser", event_name: "Purchase", event_id: "ord_1042", event_time: CLOCK - 25 * MIN,
      event_source_url: `${SITE}/checkout/thank-you?order=1042&plan=tirzepatide-monthly`,
      custom_data: { value: 349, currency: "USD", order_id: "1042", content_ids: ["sku_204"], content_name: "Tirzepatide Monthly Plan" },
    },
  },
  {
    label: "Purchase, order 1043",
    event: {
      channel: "browser", event_name: "Purchase", event_id: "ord_1043", event_time: CLOCK - 18 * MIN,
      event_source_url: `${SITE}/checkout/thank-you?order=1043`,
      custom_data: { value: 129, currency: "USD", order_id: "1043", content_ids: ["sku_310"] },
    },
  },
  {
    label: "Purchase, order 1039",
    event: {
      channel: "browser", event_name: "Purchase", event_id: "ord_1039", event_time: CLOCK - 3 * DAY - 2 * 3600,
      event_source_url: `${SITE}/checkout/thank-you?order=1039`,
      custom_data: { value: 349, currency: "USD", order_id: "1039", content_ids: ["sku_204"] },
    },
  },
];

/** What the server sends through the Conversions API, from store, form and booking webhooks. */
export const serverEvents = [
  {
    label: "Lead, intake form",
    event: {
      event_name: "Lead", event_id: "lead_5531", event_time: CLOCK - 40 * MIN + 30, action_source: "website",
      event_source_url: `${SITE}/intake?step=3&condition=type-2-diabetes`,
      user_data: { ...dana },
      custom_data: { lead_source: "intake form", form_answers: { current_medication: "metformin", bmi: "31", goal: "lose 15 kg" } },
    },
  },
  {
    label: "Purchase, order 1042",
    event: {
      event_name: "Purchase", event_id: "ord_1042", event_time: CLOCK - 25 * MIN + 20, action_source: "website",
      event_source_url: `${SITE}/checkout/thank-you?order=1042&plan=tirzepatide-monthly`,
      user_data: { ...dana },
      custom_data: { value: 349, currency: "USD", order_id: "1042", content_ids: ["sku_204"], content_name: "Tirzepatide Monthly Plan" },
    },
  },
  {
    label: "Purchase, order 1043",
    event: {
      event_name: "Purchase", event_id: "1043", event_time: CLOCK - 18 * MIN + 15, action_source: "website",
      event_source_url: `${SITE}/checkout/thank-you?order=1043`,
      user_data: { ...sam },
      custom_data: { value: 129, currency: "USD", order_id: "1043", content_ids: ["sku_310"], content_name: "Sildenafil 50 mg, 8 tablets" },
    },
  },
  {
    label: "Purchase, order 1039, replayed",
    event: {
      event_name: "Purchase", event_id: "ord_1039", event_time: CLOCK - 3 * DAY - 2 * 3600 + 40, action_source: "website",
      event_source_url: `${SITE}/checkout/thank-you?order=1039`,
      user_data: { em: "riley.park@example.com", client_ip_address: "192.0.2.61", client_user_agent: UA },
      custom_data: { value: 349, currency: "USD", order_id: "1039", content_ids: ["sku_204"] },
    },
  },
  {
    label: "Purchase, order 0987, replayed",
    event: {
      event_name: "Purchase", event_id: "ord_0987", event_time: CLOCK - 9 * DAY, action_source: "website",
      event_source_url: `${SITE}/checkout/thank-you?order=0987`,
      user_data: { em: "jo.martin@example.com", client_ip_address: "192.0.2.90", client_user_agent: UA },
      custom_data: { value: 199, currency: "USD", order_id: "0987", content_ids: ["sku_118"] },
    },
  },
  {
    label: "Consult booked",
    event: {
      event_name: "", event_id: "book_8812", event_time: CLOCK - 10 * MIN, action_source: "website",
      event_source_url: `${SITE}/book/thanks`,
      user_data: { em: "sam.lee@example.com", client_ip_address: "198.51.100.7", client_user_agent: UA },
      custom_data: { booking_tool: "calendar", consult_type: "Hormone therapy intake" },
    },
  },
];

const H_DANA = "fa41c818b5c474f7cd54a08168c58b26d7be47b357fad28353c031829dad3c2e";
const H_DANA_PH = "6c7571d8368bc16f7d2349de5f0a74ca59b1de6bccf75e832bc6ff9aa7e3f014";

/**
 * A Conversions API batch built by hand, without the gate, the way a quick
 * integration might send it. Six planted mistakes, two clean events.
 */
export const handBatch = [
  {
    event_name: "Purchase", event_id: "ord_1042", event_time: CLOCK - 25 * MIN + 20, action_source: "website",
    event_source_url: `${SITE}/checkout/thank-you`,
    user_data: { em: H_DANA, ph: H_DANA_PH, fbp: FBP, client_ip_address: "203.0.113.24", client_user_agent: UA },
    custom_data: { value: 349, currency: "USD", order_id: "1042" },
  },
  {
    event_name: "Lead", event_id: "lead_5531", event_time: CLOCK - 40 * MIN + 30, action_source: "website",
    event_source_url: `${SITE}/intake`,
    user_data: { em: "Dana.Reyes@example.com", fbp: FBP, client_ip_address: "203.0.113.24", client_user_agent: UA },
  },
  {
    event_name: "ViewContent", event_id: "vc_9b22", event_time: CLOCK - 30 * MIN, action_source: "website",
    event_source_url: `${SITE}/products/tirzepatide-monthly`,
    user_data: { fbp: FBP, client_ip_address: "203.0.113.24", client_user_agent: UA },
    custom_data: { content_ids: ["sku_204"], content_type: "product" },
  },
  {
    event_name: "Purchase", event_id: "ord_1044", event_time: CLOCK - 12 * MIN, action_source: "website",
    event_source_url: `${SITE}/checkout/thank-you`,
    user_data: { fbp: "fb.1.1794469100456.5521098834", client_ip_address: "198.51.100.7", client_user_agent: UA },
    custom_data: { value: 89, currency: "USD", order_id: "1044", content_name: "Sildenafil 50 mg, 8 tablets" },
  },
  {
    event_name: "Purchase", event_id: "1043", event_time: CLOCK - 18 * MIN + 15, action_source: "website",
    event_source_url: `${SITE}/checkout/thank-you`,
    user_data: { fbp: "fb.1.1794469100456.5521098834", client_ip_address: "198.51.100.7", client_user_agent: UA },
    custom_data: { value: 129, currency: "USD", order_id: "1043" },
  },
  {
    event_id: "book_8812", event_time: CLOCK - 10 * MIN, action_source: "website",
    event_source_url: `${SITE}/book/thanks`,
    user_data: { client_ip_address: "198.51.100.7", client_user_agent: UA },
  },
  {
    event_name: "Purchase", event_id: "ord_0990", event_time: CLOCK - 8 * DAY, action_source: "website",
    event_source_url: `${SITE}/checkout/thank-you`,
    user_data: { client_ip_address: "192.0.2.90", client_user_agent: UA },
    custom_data: { value: 199, currency: "USD", order_id: "0990" },
  },
  {
    event_name: "AddToCart", event_id: "atc_3310", event_time: CLOCK - 6 * MIN, action_source: "website",
    event_source_url: `${SITE}/cart`,
    user_data: { fbp: FBP, client_ip_address: "203.0.113.24", client_user_agent: UA },
    custom_data: { value: 199, currency: "USD", content_ids: ["sku_118"] },
  },
];
