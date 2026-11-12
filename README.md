# Event Gate

A health brand's ad events have to reach Meta to count, and must not carry health details when they do. This page takes browser pixel events and server events from a made-up telehealth clinic and shows what would be sent, what was removed or hashed on the way, and what was held back and why.

Everything runs in the browser. There are no keys, no network calls and no model. The data is sample data: a made-up clinic on the reserved `brightpath.example` domain, made-up people and made-up orders.

## What it does

**Cleans every event before it leaves.**

- URLs keep the domain and a short list of campaign params (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `fbclid`). A path with a health term is cut to `/`. A param with a health term goes, and so does every param not on the list.
- `custom_data` keeps `value`, `currency`, `content_ids`, `content_type`, `num_items` and `order_id`. `content_name`, `content_category` and `search_string` stay only when they hold no health term. Anything else, such as free-text form answers, never leaves.
- `user_data` fields Meta asks to be hashed are normalised and SHA-256 hashed. `client_ip_address`, `client_user_agent`, `fbc` and `fbp` are sent as they are. Other fields are dropped.

**Matches browser and server copies by Meta's recommended method.** A browser event and a server event are one conversion when `event_name` and `event_id` match and the second arrives within 48 hours of the first.

**Runs a last check on the outgoing payload and holds back what would go wrong.** The check does not fix anything. It blocks with a reason.

| Held back when | Why |
| --- | --- |
| A hashed field (`em`, `ph`, `fn`, ...) is not a 64-character SHA-256 hex string | A raw email or phone number would leave |
| A health term appears in any outgoing string outside `user_data` | URL, product name, search term or any other param |
| A server event shares an order with a browser event but not its `event_id` | Meta cannot pair them by `event_id` and may count the sale twice |
| A server copy arrives more than 48 hours after the browser copy | Meta no longer matches them, so it would count twice. This is the replay trap: a replay can be inside the 7-day window and still outside the 48-hour one |
| `event_name` is missing | Meta requires it |
| `event_time` is missing or more than 7 days old | Meta rejects the whole request, not just the one event, so it is held here and the rest of the batch goes |
| `action_source` is missing, or `event_source_url` or `client_user_agent` is missing on a website event | Meta requires them |
| The same `event_name` and `event_id` appear twice in one batch | This gate's own rule, so a retry goes once |

## The sample

13 events: 7 from the browser pixel and 6 from the server. 9 are sent, 4 are held back.

- **Sent:** a lead and a purchase where the browser and server copies match and are counted once, plus page view, product view and search events from the browser. 14 health details are removed on the way, including a condition in the intake URL, a drug name in a product name and a search term, and the free-text answers on the intake form.
- **Held back:** a server purchase whose `event_id` is `1043` while the browser sent `ord_1043`; a replay of a purchase the browser sent 3 days ago; a replay 9 days old; and a booking with no `event_name`.

A second panel checks a batch built by hand without the gate. It has six planted mistakes (a raw email, a health term in a URL, a health term in a product name, a mismatched `event_id`, no `event_name`, an 8-day-old `event_time`) and two clean events. All six are blocked. "Run it through the gate" fixes the first three and leaves the other three held, because it will not invent an `event_name` or rewrite an `event_id` on an order-number match, so those wait for a person. The JSON is editable.

## Meta's rules, with sources

Read on 12 Nov 2026.

- Deduplication, [Handling Duplicate Pixel and Conversions API Events](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events): a Meta Pixel's `eventID` must match the Conversions API's `event_id`, and the pixel's `event` must match `event_name`. Events "are only deduplicated if they are received within 48 hours of when we receive the first event with a given `event_id`". The same page has a second method that compares `event_name` with `fbp` and/or `external_id`, and says it generally only works when the browser event arrives first. This gate matches on `event_id` only and does not count on the second method.
- Event fields, [Server Event Parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event): `event_name` and `event_time` are required; `event_time` is a Unix timestamp in seconds in GMT and "can be up to 7 days before you send an event"; if any `event_time` is more than 7 days in the past, Meta returns an error for the entire request. `action_source` is required, and `event_source_url` is required for website events.
- Hashing, [Customer Information Parameters](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters): `em`, `ph`, `fn`, `ln`, `db`, `ge`, `ct`, `st`, `zp` and `country` require hashing and `external_id` is recommended for it; the worked examples use SHA-256. Email is trimmed and lowercased; phone numbers lose symbols, letters and leading zeros and must include a country code. `client_ip_address`, `client_user_agent`, `fbc` and `fbp` must not be hashed.

## Limits

- The health term list is a short sample. It finds whole words across separators (`glp-1`, `hair_loss`, `ozempic+alternative`), and misses new brand names, misspellings and terms in other languages. A real version would keep a list per client and add a classifier for the text the list misses.
- Cutting a path to `/` is blunt on purpose. A real version would map known paths to neutral ones so the URL still tells the ad account which page converted.
- Matching by order uses `custom_data.order_id`. Events without an order number are matched by `event_name` and `event_id` only.
- Receipt time is taken from the browser event's `event_time`, and the server batch is treated as sent at the sample clock (12 Nov 2026, 09:00 GMT).
- Browser events are shown as cleaned in the tag before they fire. In a real setup that happens in the tag or in a server container the pixel is routed through.
- Normalising is tested against Meta's worked examples for email, phone and name. Birth date, state and country are lowercased and stripped, not converted: `2/16/1997` does not become `19970216`, `California` does not become `ca`, and a phone number written `+44 (0)20` keeps its extra zero. A real version would convert them or drop the field.
- The 7-day check is applied to every event. Meta's [Using the API](https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api) page says in-person sales sent with `action_source` `physical_store` should be uploaded within 62 days, so a real version would use the longer limit for those.
- The last check does not look for an empty `user_data`.
- Consent is not modelled. Nothing here is legal advice.

## Run the tests

```
node --test
```

Needs Node 20 or later. No dependencies. 17 tests cover the sample result, Meta's own hashing examples, URL cleaning, word matching, the 48-hour and 7-day edges, retries, a missing user agent and both runs of the hand-built batch.

## Open the page locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Design

The result comes first, rows are split by hairlines instead of cards, and a red underline draws under exactly what was removed. Sintony for the headline and the result, Geist for the tool's words, monospace for payloads, an indigo accent, deep navy in dark mode, and 4px corners. Fonts are Sintony and Geist (SIL Open Font License), served from `fonts/`.

## Provenance

Built on 12 Nov 2026 with AI coding agents, directed by Arnold Ikpemosi Adeyemi.

## Licence

MIT. See `LICENSE`.
