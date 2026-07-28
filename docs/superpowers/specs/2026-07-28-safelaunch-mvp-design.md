# SafeLaunch MVP Design

**Date:** 2026-07-28  
**Status:** Approved for implementation planning  
**Market:** Vietnam  
**Primary audience:** Founders and product teams without specialist legal knowledge

## 1. Product Summary

SafeLaunch is an AI-assisted legal risk screening website for internet applications preparing to launch in Vietnam. A visitor enters a public website URL, selects an application category, and receives a bilingual Vietnamese-English report that identifies potential legal risks and cites relevant provisions from official Vietnamese legal documents.

SafeLaunch provides preliminary screening, not legal advice. It must not claim that a product is fully compliant or legally cleared for launch. The report uses a simple overall status for non-specialists while preserving detailed evidence and citations for verification.

## 2. MVP Goals

The MVP will:

- accept a public website URL without requiring an account;
- support Vietnam as the only jurisdiction;
- support online games, online press/electronic information sites, and digital entertainment/content platforms;
- inspect the homepage and discover up to four important pages: terms of service, privacy policy, about, and contact;
- evaluate deterministic checks and evidence-first RAG findings against approved legal provisions from [vbpl.vn](https://vbpl.vn);
- return a Vietnamese-English report through an unguessable private link;
- complete eligible scans within a P95 latency target of 60 seconds;
- show scan coverage, limitations, confidence, citations, and recommended actions;
- capture DOCX archives of approved provisions to enable structured text and article parsing;
- retain scan data and reports for seven days.

## 3. Non-Goals

The MVP will not:

- provide a definitive legal opinion or approval to launch;
- support jurisdictions other than Vietnam;
- scan authenticated areas or accept user credentials;
- interact with forms, payments, or state-changing controls;
- perform a broad crawl of the entire website;
- bypass CAPTCHA, bot protection, or access controls;
- provide user accounts, saved projects, or scan history;
- cover every internet business category;
- automatically use unreviewed legal documents in production analysis.

## 4. Product Principles

1. **Evidence before conclusion.** Every legal finding must preserve both the website evidence and the cited legal provision.
2. **Precision before recall.** A high-risk finding requires strong support; ambiguous cases become “Needs expert review.”
3. **No silent gaps.** Missing pages, blocked content, timeouts, and truncated input must be visible in the report.
4. **No absolute compliance claims.** The strongest positive status is “No significant risk detected within the scanned scope.”
5. **Official and approved sources only.** Production retrieval uses only reviewed provisions originating from vbpl.vn.
6. **Provider isolation.** Crawling, AI evaluation, and vector retrieval use explicit interfaces so providers can be changed without rewriting the domain logic.

## 5. User Experience

### 5.1 Homepage

The primary form is centered on the homepage and contains:

- a website URL field;
- a fixed jurisdiction selector showing Vietnam;
- an application category selector;
- a prominent scan action;
- a clear disclaimer that results are preliminary and do not replace legal advice;
- a Vietnamese-English interface language control.

No account is required anywhere in the MVP.

### 5.2 Scan Progress

After submission, the interface shows explicit stages:

1. validate the URL and fetch the homepage;
2. discover and fetch important legal/company pages;
3. extract website evidence;
4. retrieve applicable legal provisions;
5. evaluate and verify findings;
6. compose the report.

The browser polls scan status. If the scan cannot finish completely, the system returns a partial report when meaningful analysis exists. It never converts a technical failure into a clean legal result.

### 5.3 Report

The overall status is one of:

- **High risk detected**;
- **Needs review**;
- **No significant risk detected within the scanned scope**.

Each finding contains:

- severity;
- plain-language description;
- website excerpt and source URL;
- legal document name, article/clause, applicability date, and vbpl.vn URL;
- explanation connecting the website evidence to the provision;
- confidence;
- recommended action;
- classification as a current requirement or upcoming requirement.

Overall status is aggregated deterministically: any verified current high-risk finding yields `High risk detected`; otherwise any current expert-review finding or incomplete material coverage yields `Needs review`; only a completed scan with neither condition may yield `No significant risk detected within the scanned scope`. Upcoming requirements are displayed separately and do not raise the current overall status.

The report also shows the scanned and failed pages, analysis timestamp, ruleset/model version, limitations, expiry time, and legal disclaimer. Users may switch between Vietnamese and English. Vietnamese legal text remains authoritative; English legal explanations are marked as unofficial translations.

## 6. Architecture

SafeLaunch uses two independent pipelines.

### 6.1 Legal Knowledge Pipeline

`vbpl.vn -> crawler -> normalizer -> admin review -> legal index`

A scheduled crawler discovers relevant legal documents on vbpl.vn by walking listing pages and the public search index, then fetches each public document detail page to obtain the stable slug and the DOCX object reference. The ingestion queue downloads the DOCX from `vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/minio/buckets/vbpl/{folderId}/{objectName}/download`, then the normalizer extracts metadata, applicability dates, and a per-Điều article tree from the `word/document.xml` inside the DOCX. The detail-page HTML is fetched for fallback metadata. New or uncertain records enter a review queue. Only approved provisions that are currently effective or have a future effective date are eligible for production retrieval.

- **R2:** original DOCX and HTML source files, parsed provision JSON, and versioned source snapshots.
- **D1:** document metadata, provisions, relations, review state, audit history, and index references.
- **Vectorize:** embeddings for approved provisions.
- **Cloudflare Access:** protection for the internal admin console.

The crawler and indexer run outside the user scan request path.

### 6.2 Website Analysis Pipeline

`homepage form -> scan API -> safe fetcher -> evidence extractor -> deterministic rules + legal retrieval + AI evaluator -> verifier -> report composer`

The scan API creates an opaque scan identifier and invokes the orchestrator. The orchestrator applies a total deadline and per-stage budgets. Website evidence is evaluated using deterministic rules for objective omissions and RAG for provisions that require interpretation. A separate verifier rejects unsupported conclusions and invalid citations before report generation.

### 6.3 Cloudflare Components

- A Cloudflare Worker serves the web application and API.
- Cloudflare Workflows or an equivalent orchestration abstraction coordinates scan stages and exposes progress.
- Queues isolate legal ingestion, parsing, embedding, and retryable background work.
- D1 stores transactional metadata and structured analysis data.
- R2 stores large source artifacts and temporary website snapshots.
- Vectorize provides legal provision retrieval.
- AI Gateway provides model observability and routing behind a model adapter.
- Workers AI or another supported model provider performs structured extraction, evaluation, verification, and bilingual report generation.

Provider-specific calls remain behind narrow interfaces.

## 7. Component Boundaries

### 7.1 Scan API

Validates request shape, normalizes the URL, creates the scan, and returns the public scan ID. It does not crawl or perform legal analysis directly.

### 7.2 Safe Fetcher

Fetches public HTTP/HTTPS content under strict network, redirect, size, content-type, and time limits. It returns normalized fetch results without interpreting legal meaning.

### 7.3 Page Discoverer

Examines homepage links and selects at most one best candidate for each supported page type: terms, privacy, about, and contact. The total fetched set is the homepage plus at most four discovered pages.

### 7.4 Evidence Extractor

Converts page content into typed facts while retaining the source URL and exact excerpt. Examples include operator identity, contact details, data collection statements, payment signals, content model, user-generated content, and licensing claims. Website instructions are treated as untrusted content and never as system instructions.

### 7.5 Rules Engine

Runs versioned deterministic rules by application category. Initial rules cover objective signals such as missing discoverable privacy terms, missing operator identity, and missing contact information. A failed page does not prove that information is absent; coverage-aware rules must return unknown when evidence is incomplete.

### 7.6 Legal Retriever

Filters approved provisions by jurisdiction, application category, and applicability date, then applies hybrid metadata and vector retrieval. It returns provision text, stable identifiers, document metadata, and official source URLs.

### 7.7 AI Evaluator

Evaluates bounded pairs of website evidence and retrieved legal provisions using structured output. It may propose a finding, request expert review, or state that the evidence is insufficient. It may not introduce uncited legal sources.

### 7.8 Finding Verifier

Checks that cited provisions exist, were approved, apply at the relevant time, and support the proposed reasoning. It confirms the website excerpt and applies severity/confidence thresholds. Unsupported findings are rejected or downgraded to expert review.

### 7.9 Report Composer

Groups verified findings, calculates the overall status using deterministic aggregation rules, produces Vietnamese and English explanations, and lists scope limitations. Translation cannot change severity, citations, confidence, or recommended action semantics.

### 7.10 Legal Ingestion and Admin Console

The ingestion service discovers and versions vbpl.vn records. Admin users can inspect source snapshots and metadata, approve or reject documents, correct structured metadata, and view audit history. Approval creates or refreshes searchable provision versions; rejection keeps the record out of production retrieval.

## 8. Core Data Model

- `legal_documents`: official metadata, source URL, lifecycle dates, review state, and source version.
- `legal_provisions`: versioned article/clause text, applicability interval, category tags, and vector reference.
- `document_relations`: amendment, supplement, replacement, repeal, and related-document edges.
- `legal_review_events`: admin decision, actor, timestamp, reason, and before/after state.
- `scans`: normalized URL, category, state, timestamps, deadline, coverage, and analysis version identifiers.
- `scan_pages`: page type, URL, fetch state, language, content hash, R2 reference, and truncation details.
- `evidence_items`: typed fact, normalized value, source excerpt, source URL, and extraction confidence.
- `findings`: severity, status, reasoning, confidence, recommended action, and current/upcoming classification.
- `finding_citations`: finding-to-provision links and quoted legal text.
- `reports`: bilingual presentation payload, token hash, expiry, and deletion status.
- `rule_versions`: immutable deterministic rule bundles.
- `analysis_runs`: model, prompt, retrieval, and ruleset versions used by a scan.

Large artifacts remain in R2; D1 stores queryable metadata and structured output.

## 9. Legal Document Lifecycle

A legal document progresses through:

`discovered -> fetched -> parsed -> pending_review -> approved | rejected | superseded`

A new source version does not overwrite an approved version. It creates a new version for review. Search eligibility is computed from review state and applicability dates. Upcoming requirements are retrieved separately and displayed with their effective dates. Expired or superseded provisions remain available for audit but are not used for current/future launch screening unless needed to resolve a document relationship.

## 10. Scan Data Flow and Deadline

1. Validate URL and create scan.
2. Resolve DNS and run network safety checks.
3. Fetch homepage and discover supported page links.
4. Fetch selected pages concurrently within per-page limits.
5. Extract and deduplicate typed evidence.
6. Run deterministic rules.
7. Retrieve a bounded set of approved provisions by evidence topic and category.
8. Evaluate bounded evidence-provision pairs.
9. Verify citations, applicability, reasoning, and severity.
10. Aggregate status and generate a bilingual report.
11. Persist the report and return its private URL.

The orchestrator enforces per-stage budgets and a total 60-second target. The implementation plan will benchmark and tune exact page, byte, token, and retrieval limits. When a budget is exhausted, the report records the omitted scope and uses partial/unknown states rather than making a positive compliance claim.

## 11. Security, Privacy, and Abuse Controls

- Accept only public HTTP/HTTPS URLs.
- Resolve and validate DNS before requests and after every redirect.
- Block loopback, private, link-local, metadata, multicast, reserved, and otherwise non-public destinations for IPv4 and IPv6.
- Limit redirects, response bytes, decompressed bytes, page count, content types, and duration.
- Do not authenticate, execute payments, submit forms, or perform state-changing actions.
- Identify the crawler and apply domain-level rate limits.
- Do not bypass CAPTCHA or access controls.
- Treat all website content as untrusted prompt input and isolate it from system instructions.
- Protect the admin console with Cloudflare Access and record review audit events.
- Use unguessable report tokens and store only token hashes.
- Add `noindex` headers/meta to report pages and exclude them from sitemaps.
- Avoid logging raw website content, private report tokens, or full prompts.
- Apply request throttling and abuse limits to anonymous scans.

Scan snapshots, evidence, and reports expire seven days after creation. A scheduled deletion job removes expired D1 and R2 data within 24 hours. Aggregated, non-content operational metrics may be retained.

## 12. Error Handling

Scan terminal outcomes are:

- `completed`: all selected pages and analysis stages completed;
- `partial`: meaningful analysis completed with explicit missing coverage;
- `failed`: the homepage was unsafe/unavailable or evidence was insufficient for meaningful analysis.

Failures from AI or Vectorize may produce a rules-only partial report when deterministic results are meaningful. The report must label the analysis as limited. A technical error never produces a “No significant risk detected” status.

Citation or applicability validation failures reject the affected finding. Ambiguous evidence becomes “Needs expert review.” Upcoming provisions appear separately and never imply a current violation.

## 13. Testing Strategy

### 13.1 Automated Tests

- Unit tests for URL validation, SSRF controls, HTML extraction, discovery, rule evaluation, lifecycle dates, and document relations.
- Contract tests for every module boundary and all structured AI outputs.
- Integration tests for D1, R2, Vectorize, Queues/Workflows, and ingestion fixtures.
- End-to-end tests for all three application categories and Vietnamese/English websites.
- Security tests for redirect-to-private-IP, DNS rebinding, oversized/decompression responses, prompt injection, expired tokens, and admin authorization.
- Regression fixtures for every confirmed citation or classification defect.

### 13.2 Legal Evaluation Set

A human-reviewed benchmark includes clear risks, safe/insufficient-evidence cases, expert-review cases, current/upcoming/superseded provisions, and Vietnamese, English, and bilingual sites. Before MVP acceptance, it contains at least 30 high-risk examples (at least 10 for each supported application category) and at least 30 examples whose correct outcome is not high risk. Any model, prompt, chunking, retrieval, or rule change runs against this benchmark before release.

### 13.3 Acceptance Criteria

- 100% of report citations resolve to an approved provision and official vbpl.vn source URL.
- No high-risk finding lacks website evidence or an applicable legal basis.
- High-risk precision is at least 90% on the internal human-reviewed benchmark.
- Eligible scans meet a P95 completion target below 60 seconds. An eligible scan has a publicly reachable homepage, no access challenge, supported HTML content within configured byte limits, and no upstream Cloudflare or model-provider outage; partial and failed scans are reported separately.
- Every report includes coverage, timestamp, analysis versions, expiry, and disclaimer.
- Vietnamese and English reports preserve identical severities, citations, confidence values, and action semantics.
- Expired scan content is removed within 24 hours after the seven-day retention period.

## 14. Observability

Track scan completion/partial/failure rate, stage latency, pages fetched, verifier rejection rate, retrieval quality metrics, AI cost per scan, crawler errors by domain, ingestion lag, and pending legal review count. Telemetry excludes raw website content and private report tokens.

## 15. Initial Delivery Boundaries

The implementation should preserve the two-pipeline architecture but deliver vertical slices:

1. legal document ingestion and approval for a curated initial vbpl.vn corpus;
2. safe website fetch and evidence extraction;
3. deterministic rules and evidence-first retrieval/evaluation;
4. verifier and bilingual report;
5. anonymous homepage flow, progress UI, and admin console;
6. security, benchmark, observability, and retention hardening.

The detailed task order, exact Cloudflare bindings, schemas, quotas, and model selection belong to the implementation plan. They must satisfy the boundaries and acceptance criteria in this design.
