# ADMIN-05 — System health design

## Principle

Every section reports `available`, `degraded`, or `unknown`, with a timestamp.
One failed dependency must not fail the whole response. `unknown` is preferred
over inferred or fabricated health.

## Direct runtime signals

- D1: aggregate row counts, oldest active scan, oldest pending legal review.
- R2: aggregate object count/bytes under `scans/`; never return object keys.
- Vectorize: `describe()` dimensions and vector count.

Each source is queried independently and errors are reduced to a stable reason
code; exception messages are not returned because they may contain resource
details.

## Signals unavailable from current bindings

Queue backlog, Workflow instances/error rate, Durable Object active-key counts,
and Workers AI request/latency/error metrics cannot be queried from their
current runtime bindings. These sections return `unknown` with
`analytics_not_configured`. A later infrastructure slice can connect Workers
Analytics Engine or a privileged Cloudflare API proxy.

## Privacy

The endpoint returns aggregate counts only. It must not return URLs, R2 keys,
IP/host hashes, prompts, model inputs, legal text, tokens, or raw errors.
