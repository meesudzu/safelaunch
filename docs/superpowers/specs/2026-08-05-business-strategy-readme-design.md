---
title: Business Strategy Section for README.vi.md
date: 2026-08-05
status: draft (awaiting user review)
owner: docs
project: SafeLaunch
related:
  - README.vi.md
  - docs/superpowers/specs/2026-07-28-safelaunch-mvp-design.md
  - docs/superpowers/specs/2026-08-03-daily-domain-quota-design.md
  - apps/workers/src/services/redeem-codes.ts
  - apps/workers/src/services/quota-service.ts
  - apps/web/src/app/[locale]/admin/redeem-codes/page.tsx
  - packages/compliance-core/src/domain-key.ts
  - .codex/skills/safelaunch-overview/SKILL.md
  - .codex/skills/safelaunch-ai-workflow/SKILL.md
---

# Business Strategy Section for README.vi.md

## 1. Background

`README.vi.md` currently runs 17 sections covering product, architecture,
compliance, privacy, design, repo structure, dev, test, deploy, release, and
contribution. It is comprehensive on the technical and operational axes but
has **no explicit business-strategy section**: positioning, ICPs, value by
segment, monetization shape, competitive stance, and commitments to customers
are either absent or only implied.

This matters for two reader types we have already named:

1. **Founders / team** need a shared, durable statement of who we are building
   for, why we are different, and how money enters the picture — without
   having to re-derive it from the technical sections.
2. **Investors and agency partners** who skim the README in 60–90 seconds
   need to land on the answers to three questions before they read anything
   else: _who is this for, what makes it different, how does it make money._

The project does **not** have a separate business-strategy document elsewhere
in the repo (`docs/remaining.md`, MVP design, the three superpower specs and
plans all contain no strategy content). The only strategy-adjacent artifact is
the "Gói mở rộng / Extension package" UI stub plus the working redeem-code
path in code — both need to be reflected in narrative form.

This design therefore adds **one** new top-level section to `README.vi.md` and
updates the table of contents. No code, no schema, no migration.

## 2. Goals

- **G1** Add a Vietnamese-language business-strategy section to `README.vi.md`
  that is consistent with brand voice and existing writing style in that file.
- **G2** Reader can answer the three core questions (who / how different /
  how monetized) within 60–90 seconds of arriving at the section.
- **G3** Every factual claim about the product is grounded in either an
  existing file path in this repo or an existing spec / doc — no invented
  market numbers, no invented competitor names.
- **G4** The section is honest about what is _not yet_ public (paid-package
  pricing, specific timeline) without hand-waving or filler.
- **G5** The section strictly follows `safelaunch-ai-workflow` anti-slop rules
  for non-UI copy: no filler intros, no emoji bullets, no AI hedge phrases,
  active voice, plain language.

## 3. Non-goals

- **N1** No new business-strategy document under `docs/` — the strategy lives
  in `README.vi.md` only for this iteration. If a separate investor memo is
  needed later, it is a follow-up task.
- **N2** No pricing numbers, no launch date for the paid package, no
  competitor brand names. Confirmed with user as the stance of this section.
- **N3** No translation of this section into English or any other language.
  `README.md` (English) is out of scope for this change.
- **N4** No changes to code, schema, migration, UI, copy in `apps/web/`, or
  tests. This is doc-only.
- **N5** No reordering beyond the single insertion point described in §5.

## 4. Voice and anti-slop constraints (carried from project rules)

From `.codex/skills/safelaunch-overview/SKILL.md`:

- Confident but careful — clear guidance, not vague warnings.
- Plain-language legal — surface the _meaning_ of regulations, not the
  legalese.
- Vietnamese-first friendly — clear Vietnamese without mixed-language slop.

From `.codex/skills/safelaunch-ai-workflow/SKILL.md` (non-UI copy rules):

- No filler intros. The section opens on substance, not on a recap of the
  tagline.
- No emoji as bullet points.
- No AI hedge phrases: "it's important to note that", "dive into", "unlock",
  "in today's fast-paced world", "comprehensive solution", "cutting-edge",
  etc. Banned in this section.
- Active voice. Subject does the verb.
- Every claim that says "X is true" must point to a file:line or a spec
  already in the repo.

## 5. Structural plan

### 5.1 Position and renumbering

- Insert the new section immediately after `## 1. Tổng quan sản phẩm`.
- Title: `## 2. Chiến lược kinh doanh`.
- All existing sections §2–§17 are renumbered to §3–§18.
- The table of contents gains one row at position 2; all other rows shift
  their anchor targets by +1.
- The reference table in `## 17. Danh mục tài liệu nguồn` (which becomes
  `## 18`) is unchanged in content — it does not enumerate sections.

### 5.2 Subsection layout (six subsections)

#### 2.1 Vị thế sản phẩm — ~80–100 từ

Expands the tagline `Ra mắt toàn cầu. Tuân thủ ngay từ đầu.` into a
positioning statement. Names the four differentiators that already exist in
code/spec — not aspirational differentiators:

- **Multi-jurisdiction by default** — grounded in MVP design §G6 and
  `packages/compliance-core/src/`.
- **Source-attributed** — grounded in §6 (LLM, RAG and verification) and the
  `retrievedAt` discipline in rubrics.
- **Evidence-led** — grounded in the evidence-extraction step in §4.3 and
  the verifier in §6.3.
- **Privacy by design** — grounded in §8 and `domain-key.ts` (no raw URL
  stored as quota key, only normalized host).

Format: prose, one short paragraph. No table here. No bullets.

#### 2.2 Khách hàng mục tiêu — ~120–150 từ, three short paragraphs

Three ICPs. Each paragraph: one sentence for who they are, one sentence for
their pain, one sentence for how SafeLaunch fits in MVP. No bullet list here
— paragraph form so the prose does not look like marketing copy.

- **Founder / PM tại Việt Nam chuẩn bị launch** sản phẩm số thuộc một trong
  ba nhóm MVP (trò chơi điện tử trực tuyến, báo điện tử, giải trí số).
- **Legal / ops lead tại doanh nghiệp nhỏ-vừa** cần kiểm tra nhanh trước khi
  gửi nội bộ hoặc audit định kỳ.
- **Agency / reseller** hỗ trợ nhiều khách hàng cùng lúc và muốn giảm thời
  gian review thủ công.

#### 2.3 Giá trị theo nhóm — one 3-column table

Three columns: `Nhóm khách hàng | Pain point | Cách SafeLaunch giải quyết`.
Three rows (one per ICP). Every cell in the third column anchors to a
specific MVP capability that exists today:

| Nhóm khách hàng   | Pain point                                             | Cách SafeLaunch giải quyết                                                                                                 |
| ----------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Founder / PM      | Không biết điểm nào trên site vi phạm trước khi ra mắt | Báo cáo song ngữ Việt–Anh trong khoảng 60 giây, mỗi phát hiện kèm trích dẫn nguồn luật                                     |
| Legal / ops lead  | Phải review thủ công nhiều site cùng lúc, dễ sót       | Rules engine + AI có xác minh bắt buộc, chạy lại được trên cùng một URL                                                    |
| Agency / reseller | Khách yêu cầu kiểm tra nhiều domain mỗi tuần           | Quota 1 lượt/domain/UTC ngày với admin redeem code để mở rộng — đã chạy trong `apps/workers/src/services/quota-service.ts` |

The third-column MVP claims must cite the existing file paths shown.

#### 2.4 Mô hình thương mại hoá — ~120–150 từ + short list

Three phases, **no numbers, no timeline**:

- **Hiện tại (MVP)**: miễn phí với quota 1 lượt/domain/UTC ngày; admin có
  thể cấp redeem code để mở rộng quota — code path đã chạy trong
  `apps/workers/src/services/redeem-codes.ts` và UI admin tại
  `apps/web/src/app/[locale]/admin/redeem-codes/page.tsx`.
- **Sắp tới**: gói trả phí mở rộng — UI stub đã tồn tại với tên "Gói mở
  rộng / Extension package". Mô hình giá và phạm vi đang được thiết kế, chưa
  công bố.
- **Cam kết dài hạn** (short list, three items): không bán dữ liệu scan;
  không nhúng quảng cáo vào báo cáo; không thu thập IP hoặc email tuỳ vị để
  theo dõi cá nhân.

The three commitment items are direct lifts of the privacy rules in §8 of
the existing README.

#### 2.5 Ranh giới cạnh tranh — one 4-row × 2-column table

Columns: `Cách tiếp cận hiện có | Cách SafeLaunch làm`. **No brand names.**
Four rows covering the same axes as §2.1 — evidence-led,
source-attributed, multi-jurisdiction, privacy-by-design — without
naming the existing approach explicitly as a "competitor":

| Cách tiếp cận hiện có                | Cách SafeLaunch làm                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| Tự review thủ công trước khi ra mắt  | Rules engine + AI, mỗi phát hiện kèm trích đoạn văn bản và nguồn luật             |
| Tư vấn luật ad-hoc từng dự án        | Corpus đa jurisdiction có quy trình review (xem `docs/compliance/`)               |
| Công cụ nước ngoài đơn jurisdiction  | Multi-jurisdiction mặc định — GDPR, CCPA, Vietnam PDPD, US state laws, +1 APAC    |
| Thu thập IP và cookie để chống abuse | Chỉ host đã chuẩn hoá + UTC day, xem `packages/compliance-core/src/domain-key.ts` |

#### 2.6 Cam kết với khách hàng — ~80–100 từ, two short lists

Aligned with brand principle "Trust the human" from
`.codex/skills/safelaunch-overview/SKILL.md`:

**SafeLaunch sẽ** (five items, each a short clause):

- Trích dẫn nguồn luật với article, URL và ngày truy xuất cho mỗi phát
  hiện.
- Trả báo cáo song ngữ Việt–Anh.
- Neo phát hiện vào bằng chứng thực từ website, không suy đoán.
- Mặc định đa jurisdiction; một jurisdiction duy nhất chỉ khi người dùng
  yêu cầu.
- Báo rõ khi bằng chứng chưa đủ và đề xuất bước tiếp theo.

**SafeLaunch sẽ không** (four items):

- Đưa ý kiến pháp lý có tính quyết định thay chuyên gia.
- Bán dữ liệu scan hoặc báo cáo.
- Nhúng quảng cáo vào báo cáo.
- Theo dõi cá nhân qua IP, email hoặc cookie tuỳ vị.

## 6. Files touched

| File                                                                   | Change                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `README.vi.md`                                                         | Insert §2 (six subsections); renumber §2–§17 → §3–§18; update Mục lục |
| `docs/superpowers/specs/2026-08-05-business-strategy-readme-design.md` | This spec (new file)                                                  |

No other file is modified.

## 7. Verification

This is a doc-only change. Verification is manual but mandatory:

1. **V1 — Section integrity.** Rendered Markdown preview of §2 has all six
   subsections in order, no broken anchors, no empty cells in the two tables.
2. **V2 — Numbering.** Every reference in §1–§18 that used to point at
   `§N` now points at the new number; the Mục lục anchors match.
3. **V3 — Anti-slop lint.** Read-through against §4 of this spec — no
   banned phrases, no emoji bullets, no filler intros, active voice.
4. **V4 — Citation lint.** Every claim of the form "đã có trong code" has a
   `path:line` or path mention. Cross-checked by reading the cited lines.
5. **V5 — Build still green.** `pnpm -w build` and `pnpm -w test` still
   pass — README change should not affect either, but we run them as the
   lightest gate. Required by `safelaunch-ai-workflow` Phase 4 step 11
   even for doc-only changes. Note: if the implementation worktree does
   not have `node_modules/` populated (because it is a fresh `git worktree`
   split off for a doc-only change), V5 is satisfied by running the gates
   from the main worktree where the lockfile is already installed; we do
   not block the doc change on a fresh `pnpm install`.

## 8. Rollout

Doc-only change, no deploy step. After merge to `main`, the new section is
visible on the next README render (no rebuild required for static docs).
No rollback plan needed beyond `git revert`; no data migration.

## 9. Out-of-scope follow-ups (not part of this design)

These were deliberately excluded and are recorded here so a future agent
does not re-litigate them:

- An English-language equivalent in `README.md`.
- A separate `docs/strategy.md` for investors.
- Pricing numbers, launch date, and competitor brand names — all
  intentionally omitted per user confirmation in brainstorming.
- A new admin UI surface for the future paid package.

End of spec (awaiting user review).
