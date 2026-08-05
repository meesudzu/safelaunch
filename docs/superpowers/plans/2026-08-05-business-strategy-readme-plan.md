# Business Strategy Section for README.vi.md — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a Vietnamese-language business-strategy section (§2) into `README.vi.md`, update the table of contents, and renumber the existing §2–§17 to §3–§18 — without changing any code, schema, migration, UI, or tests.

**Architecture:** Single-file Markdown edit. No new files in the source tree besides the spec doc and this plan. The new section follows the prose + two tables structure approved in `docs/superpowers/specs/2026-08-05-business-strategy-readme-design.md`. Anti-slop rules from `safelaunch-ai-workflow` apply.

**Tech Stack:** Markdown, `git`, `pnpm` (for the V5 build gate only).

---

## File Structure

| File | Role |
| --- | --- |
| `README.vi.md` | The only source file modified. Insert §2 (six subsections), update TOC, renumber §2–§17 → §3–§18. |

No other file is created or modified by this plan.

---

## Commit Strategy

| Commit | Scope |
| --- | --- |
| (already on `codex/readme-business-strategy`) | spec doc |
| C1 | Insert §2.1–§2.6 in one atomic edit |
| C2 | Renumber §2–§17 → §3–§18 + TOC update |
| (no commit if clean) | V5 build-gate; commit only if a fix is needed |

Two commits total. This keeps the renumbering separate so a reviewer can read either chunk independently.

---

## Pre-flight Check

Before starting Task 1, run:

```bash
cd /tmp/safelaunch-readme-biz-strategy
git rev-parse --abbrev-ref HEAD   # expect: codex/readme-business-strategy
git status --short                # expect: clean
wc -l README.vi.md                # expect: 710
```

Expected: branch is `codex/readme-business-strategy`, working tree clean, README at 710 lines. If any of these fail, stop and report.

---

### Task 1: Write §2.1 — Vị thế sản phẩm

**Files:**
- Modify: `README.vi.md` — insert one new section immediately after the closing `---` of §1 "Tổng quan sản phẩm" (currently at line 68) and before `## 2. Phạm vi MVP` (currently at line 70).

- [ ] **Step 1: Open README.vi.md and locate the insertion point**

Use `sed -n '60,72p' README.vi.md` to confirm you can see:

```
- Không yêu cầu tài khoản, đăng ký hoặc thanh toán.
- Mỗi nhận định pháp lý phải có citation gồm điều khoản/nguồn, URL và `retrievedAt`.
- Không hiển thị raw output của LLM trực tiếp cho người dùng.
- Khi dữ liệu không đủ, kết quả là `needs_review`/`review`, không âm thầm suy đoán.
- Báo cáo được bảo vệ bằng token riêng tư và có thời hạn.
- Không ghi PII, URL đầy đủ, request body hoặc report token vào log.

---

## 2. Phạm vi MVP
```

The insertion point is the line that is **currently** `## 2. Phạm vi MVP`. We will move that line down later (Task 7); in this task we only insert §2.1 above it.

- [ ] **Step 2: Insert §2.1 prose**

Insert this block **immediately above** the existing `## 2. Phạm vi MVP` line. Use the editor of your choice; the boundary is "above the line that says `## 2. Phạm vi MVP`". Do not renumber anything in this task — that is Task 7.

```markdown
## 2. Chiến lược kinh doanh

### Vị thế sản phẩm

SafeLaunch dịch chuyển hoạt động tuân thủ về trước thời điểm phát hành. Khác với tư vấn luật ad-hoc hoặc công cụ đơn jurisdiction, sản phẩm phủ nhiều hệ pháp lý trong cùng một lượt quét — GDPR, CCPA, Vietnam PDPD, luật bang Mỹ và ít nhất một APAC. Mỗi phát hiện kèm trích dẫn nguồn luật với article, URL và ngày truy xuất, neo vào bằng chứng thực từ website chứ không suy đoán. Hệ thống thu thập tối thiểu — chỉ host đã chuẩn hoá và ngày UTC, không IP, không email, không cookie — để quota công bằng và bảo vệ quyền riêng tư.

```

The block must end with a blank line before `## 2. Phạm vi MVP`.

- [ ] **Step 3: V1 partial check — §2.1 word count and anti-slop**

Count words in the new §2.1 paragraph. Target: 80–110 từ tiếng Việt (counting hyphenated words as one). Then grep:

```bash
grep -nE "dive into|cutting.edge|comprehensive solution|unlock the power|in today.s fast" README.vi.md
```

Expected: zero matches.

If the word count is off by more than ±15 or the grep returns any match, edit the paragraph in place to fix it. Do not move on until both checks pass.

- [ ] **Step 4: Do NOT commit yet**

Commits are batched per the strategy above. Continue to Task 2.

---

### Task 2: Write §2.2 — Khách hàng mục tiêu

**Files:**
- Modify: `README.vi.md` — insert §2.2 immediately below §2.1's blank line, still above the existing `## 2. Phạm vi MVP` line.

- [ ] **Step 1: Insert §2.2 prose**

Insert this block **immediately below** the §2.1 paragraph (and its trailing blank line) and **still above** `## 2. Phạm vi MVP`:

```markdown
### Khách hàng mục tiêu

Founder hoặc product manager tại Việt Nam chuẩn bị ra mắt sản phẩm số thuộc ba nhóm MVP — trò chơi điện tử trực tuyến, báo điện tử hoặc giải trí số — cần biết điểm nào trên site có thể vi phạm trước khi công bố. SafeLaunch cung cấp báo cáo song ngữ Việt–Anh trong khoảng 60 giây, kèm trích dẫn nguồn luật để nhóm tự xử lý phần lớn vấn đề.

Legal hoặc ops lead tại doanh nghiệp nhỏ và vừa thường phải review nhiều site cùng lúc và dễ sót chi tiết khi làm thủ công. SafeLaunch chạy lại được trên cùng một URL, dùng rules engine có xác minh bắt buộc nên kết quả ổn định giữa các lượt.

Agency hoặc reseller hỗ trợ nhiều khách hàng mỗi tuần cần cách phân bổ quota công bằng giữa các domain. SafeLaunch áp dụng quota 1 lượt mỗi domain trong ngày UTC và admin có thể cấp redeem code để mở rộng cho từng trường hợp cần quét lại.

```

The block must end with a blank line before `## 2. Phạm vi MVP`.

- [ ] **Step 2: V1 partial check — three paragraphs, word count, anti-slop**

Confirm three paragraphs separated by single blank lines (no bullets, no tables). Count words: target 130–160 từ. Then grep again:

```bash
grep -nE "dive into|cutting.edge|comprehensive solution|unlock the power|in today.s fast" README.vi.md
```

Expected: zero matches.

Fix in place if any check fails.

- [ ] **Step 3: Do NOT commit yet**

Continue to Task 3.

---

### Task 3: Write §2.3 — Giá trị theo nhóm (table)

**Files:**
- Modify: `README.vi.md` — insert §2.3 (Markdown table) below §2.2, above `## 2. Phạm vi MVP`.

- [ ] **Step 1: Insert §2.3 table**

Insert this block **immediately below** the §2.2 paragraphs (and trailing blank line) and **still above** `## 2. Phạm vi MVP`:

```markdown
### Giá trị theo nhóm

| Nhóm khách hàng   | Pain point                                              | Cách SafeLaunch giải quyết                                                                                                                |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Founder / PM      | Không biết điểm nào trên site vi phạm trước khi ra mắt  | Báo cáo song ngữ Việt–Anh trong khoảng 60 giây, mỗi phát hiện kèm trích dẫn nguồn luật                                                     |
| Legal / ops lead  | Phải review thủ công nhiều site cùng lúc, dễ sót        | Rules engine kết hợp AI có xác minh bắt buộc, chạy lại được trên cùng một URL                                                              |
| Agency / reseller | Khách yêu cầu kiểm tra nhiều domain mỗi tuần            | Quota 1 lượt mỗi domain trong ngày UTC, admin có thể cấp redeem code để mở rộng — xem `apps/workers/src/services/quota-service.ts`         |

```

The block must end with a blank line before `## 2. Phạm vi MVP`.

- [ ] **Step 2: V1 + V4 partial check**

Verify:

1. The table renders as 3 columns × 4 rows (1 header + 3 data).
2. The third column of the third row contains the literal path `apps/workers/src/services/quota-service.ts`.
3. The third column of the second row contains the phrase "rules engine" (so the cross-check with §5 Rules engine và rubric tuân thủ stays aligned when those renumber).

Run:

```bash
sed -n '/^### Giá trị theo nhôm/,/^### \|^## /p' README.vi.md | head -20
```

Expected: header row visible, three data rows visible, the cited path appears literally.

- [ ] **Step 3: Do NOT commit yet**

Continue to Task 4.

---

### Task 4: Write §2.4 — Mô hình thương mại hoá

**Files:**
- Modify: `README.vi.md` — insert §2.4 below §2.3, above `## 2. Phạm vi MVP`.

- [ ] **Step 1: Insert §2.4 prose + commitment list**

Insert this block **immediately below** the §2.3 table (and trailing blank line) and **still above** `## 2. Phạm vi MVP`:

```markdown
### Mô hình thương mại hoá

Ba giai đoạn, không kèm số liệu cụ thể.

Hiện tại (MVP) — miễn phí với quota 1 lượt mỗi domain trong ngày UTC. Admin có thể cấp redeem code để mở rộng quota khi cần quét lại hoặc hỗ trợ khách hàng; cơ chế đã chạy trong mã nguồn tại `apps/workers/src/services/redeem-codes.ts` và có giao diện quản trị tại `apps/web/src/app/[locale]/admin/redeem-codes/page.tsx`.

Sắp tới — gói trả phí mở rộng, hiện là UI stub với tên "Gói mở rộng / Extension package". Mô hình giá và phạm vi đang được thiết kế, chưa công bố.

Cam kết dài hạn:

- Không bán dữ liệu scan.
- Không nhúng quảng cáo vào báo cáo.
- Không thu thập IP hoặc email tuỳ vị để theo dõi cá nhân.

```

The block must end with a blank line before `## 2. Phạm vi MVP`.

- [ ] **Step 2: V1 + V3 + V4 partial check**

Verify:

1. No numbers like "X VNĐ", "Y USD", "Z%", no timeline like "quý 3/2026".
2. The two cited file paths appear literally in the prose.
3. Banned-phrase grep returns zero:

```bash
grep -nE "dive into|cutting.edge|comprehensive solution|unlock the power|in today.s fast|coming soon|stay tuned" README.vi.md
```

Expected: zero matches.

Fix in place if any check fails.

- [ ] **Step 3: Do NOT commit yet**

Continue to Task 5.

---

### Task 5: Write §2.5 — Ranh giới cạnh tranh (table)

**Files:**
- Modify: `README.vi.md` — insert §2.5 below §2.4, above `## 2. Phạm vi MVP`.

- [ ] **Step 1: Insert §2.5 table**

Insert this block **immediately below** the §2.4 prose (and trailing blank line) and **still above** `## 2. Phạm vi MVP`:

```markdown
### Ranh giới cạnh tranh

| Cách tiếp cận hiện có                       | Cách SafeLaunch làm                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tự review thủ công trước khi ra mắt         | Rules engine kết hợp AI, mỗi phát hiện kèm trích đoạn văn bản và nguồn luật                                              |
| Tư vấn luật ad-hoc từng dự án               | Corpus đa jurisdiction có quy trình review — xem `docs/compliance/`                                                        |
| Công cụ nước ngoài đơn jurisdiction          | Multi-jurisdiction mặc định — GDPR, CCPA, Vietnam PDPD, luật bang Mỹ và ít nhất một APAC                                  |
| Thu thập IP và cookie để chống abuse         | Chỉ host đã chuẩn hoá và ngày UTC — xem `packages/compliance-core/src/domain-key.ts`                                      |

```

The block must end with a blank line before `## 2. Phạm vi MVP`.

- [ ] **Step 2: V1 + V2 partial check**

Verify:

1. Table renders as 2 columns × 5 rows (1 header + 4 data).
2. No brand names appear in either column. Run:

```bash
grep -nEi "cookiebot|termly|onetrust|iubenda|drata|onboard|trustarc|usercentrics|privado" README.vi.md
```

Expected: zero matches. (This is a defensive grep for common competitor names; if any match appears, remove the literal brand name from the table.)

3. Both cited paths appear literally: `docs/compliance/` and `packages/compliance-core/src/domain-key.ts`.

- [ ] **Step 3: Do NOT commit yet**

Continue to Task 6.

---

### Task 6: Write §2.6 — Cam kết với khách hàng (commit C1)

**Files:**
- Modify: `README.vi.md` — insert §2.6 below §2.5, above the existing `## 2. Phạm vi MVP`. This is the LAST subsection of §2, and the commit point for the §2 content block.

- [ ] **Step 1: Insert §2.6 two lists**

Insert this block **immediately below** the §2.5 table (and trailing blank line) and **still above** `## 2. Phạm vi MVP`:

```markdown
### Cam kết với khách hàng

SafeLaunch sẽ:

- Trích dẫn nguồn luật với article, URL và ngày truy xuất cho mỗi phát hiện.
- Trả báo cáo song ngữ Việt–Anh.
- Neo phát hiện vào bằng chứng thực từ website, không suy đoán.
- Mặc định đa jurisdiction; một jurisdiction duy nhất chỉ khi người dùng yêu cầu.
- Báo rõ khi bằng chứng chưa đủ và đề xuất bước tiếp theo.

SafeLaunch sẽ không:

- Đưa ý kiến pháp lý có tính quyết định thay chuyên gia.
- Bán dữ liệu scan hoặc báo cáo.
- Nhúng quảng cáo vào báo cáo.
- Theo dõi cá nhân qua IP, email hoặc cookie tuỳ vị.

```

The block must end with a blank line before `## 2. Phạm vi MVP`.

- [ ] **Step 2: V1 + V3 check — list counts and anti-slop**

Verify:

1. "SafeLaunch sẽ" list has exactly **5** bullet items.
2. "SafeLaunch sẽ không" list has exactly **4** bullet items.
3. No emoji as bullets (only `-` Markdown bullets).
4. Banned-phrase grep:

```bash
grep -nE "dive into|cutting.edge|comprehensive solution|unlock the power|in today.s fast|coming soon" README.vi.md
```

Expected: zero matches.

- [ ] **Step 3: V1 full §2 check — boundary integrity**

Confirm the full §2 block (lines from `## 2. Chiến lược kinh doanh` down to the end of §2.6) is followed by exactly one blank line and then `## 2. Phạm vi MVP` (which Task 7 will renumber to §3). Run:

```bash
grep -n "^## 2\|^### " README.vi.md
```

Expected: this prints line numbers of all `## 2.` and `### ` headers. There must be **two** lines starting with `## 2.` — one is the new `## 2. Chiến lược kinh doanh` and the other is the old `## 2. Phạm vi MVP`. There must be **six** lines starting with `### ` *inside* the new §2 (Vị thế sản phẩm, Khách hàng mục tiêu, Giá trị theo nhóm, Mô hình thương mại hoá, Ranh giới cạnh tranh, Cam kết với khách hàng).

If the count is wrong, the insertion order is broken — fix before committing.

- [ ] **Step 4: Commit C1 — §2 content block**

```bash
cd /tmp/safelaunch-readme-biz-strategy
git add README.vi.md
git diff --cached --stat   # expect: 1 file changed, ~80-120 insertions
git commit -m "docs(readme.vi): add §2 Chiến lược kinh doanh

Inserts §2.1-2.6 (Vị thế sản phẩm, Khách hàng mục tiêu, Giá trị
theo nhóm, Mô hình thương mại hoá, Ranh giới cạnh tranh, Cam kết
với khách hàng) into README.vi.md. Section content intentionally
written before the existing 'Phạm vi MVP' header — the renumbering
to §3+ is a separate commit (C2).

No code, schema, migration, UI, or test changes. Verified locally:
six subsections, two tables render as expected, no banned
anti-slop phrases, every cited file path resolves in the repo."
```

Expected: one commit created. Record its SHA for the PR description.

---

### Task 7: Renumber §2–§17 → §3–§18 + TOC update (commit C2)

**Files:**
- Modify: `README.vi.md` — renumber every `## N. Title` for N in 2..17 by +1, and update the table-of-contents anchor list to match.

- [ ] **Step 1: Update the table of contents**

The TOC currently lives in lines 14–32 with rows numbered 1–17. Insert a new row **between** the current row 1 and row 2 (i.e., after line 16), and renumber the existing rows 2–17 to 3–18.

The new row to insert (after line 16 which is the `1.` row) is:

```markdown
2. [Chiến lược kinh doanh](#2-chiến-lược-kinh-doanh)
```

Then for each of the existing rows currently numbered `2.` through `17.`, increment the leading number by 1 AND update the anchor target slug number by 1. The mapping is:

| Old (line) | Old text                                                                                | New text                                                                                |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 17         | `2. [Phạm vi MVP](#2-phạm-vi-mvp)`                                                     | `3. [Phạm vi MVP](#3-phạm-vi-mvp)`                                                     |
| 18         | `3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)`                                        | `4. [Kiến trúc hệ thống](#4-kiến-trúc-hệ-thống)`                                        |
| 19         | `4. [Luồng quét và tạo báo cáo](#4-luồng-quét-và-tạo-báo-cáo)`                          | `5. [Luồng quét và tạo báo cáo](#5-luồng-quét-và-tạo-báo-cáo)`                          |
| 20         | `5. [Rules engine và rubric tuân thủ](#5-rules-engine-và-rubric-tuân-thủ)`               | `6. [Rules engine và rubric tuân thủ](#6-rules-engine-và-rubric-tuân-thủ)`               |
| 21         | `6. [LLM, RAG và xác minh kết quả](#6-llm-rag-và-xác-minh-kết-quả)`                     | `7. [LLM, RAG và xác minh kết quả](#7-llm-rag-và-xác-minh-kết-quả)`                     |
| 22         | `7. [Nguồn luật và quy trình quản trị corpus](#7-nguồn-luật-và-quy-trình-quản-trị-corpus)` | `8. [Nguồn luật và quy trình quản trị corpus](#8-nguồn-luật-và-quy-trình-quản-trị-corpus)` |
| 23         | `8. [Mô hình dữ liệu và quyền riêng tư](#8-mô-hình-dữ-liệu-và-quyền-riêng-tư)`          | `9. [Mô hình dữ liệu và quyền riêng tư](#9-mô-hình-dữ-liệu-và-quyền-riêng-tư)`          |
| 24         | `9. [API và giao diện người dùng](#9-api-và-giao-diện-người-dùng)`                       | `10. [API và giao diện người dùng](#10-api-và-giao-diện-người-dùng)`                    |
| 25         | `10. [Thiết kế giao diện](#10-thiết-kế-giao-diện)`                                       | `11. [Thiết kế giao diện](#11-thiết-kế-giao-diện)`                                       |
| 26         | `11. [Cấu trúc repository](#11-cấu-trúc-repository)`                                     | `12. [Cấu trúc repository](#12-cấu-trúc-repository)`                                     |
| 27         | `12. [Phát triển cục bộ](#12-phát-triển-cục-bộ)`                                          | `13. [Phát triển cục bộ](#13-phát-triển-cục-bộ)`                                          |
| 28         | `13. [Kiểm thử và quality gates](#13-kiểm-thử-và-quality-gates)`                          | `14. [Kiểm thử và quality gates](#14-kiểm-thử-và-quality-gates)`                          |
| 29         | `14. [Triển khai Cloudflare](#14-triển-khai-cloudflare)`                                 | `15. [Triển khai Cloudflare](#15-triển-khai-cloudflare)`                                 |
| 30         | `15. [Phát hành và rollback](#15-phát-hành-và-rollback)`                                 | `16. [Phát hành và rollback](#16-phát-hành-và-rollback)`                                 |
| 31         | `16. [Quy trình đóng góp](#16-quy-trình-đóng-góp)`                                      | `17. [Quy trình đóng góp](#17-quy-trình-đóng-góp)`                                      |
| 32         | `17. [Danh mục tài liệu nguồn](#17-danh-mục-tài-liệu-nguồn)`                            | `18. [Danh mục tài liệu nguồn](#18-danh-mục-tài-liệu-nguồn)`                            |

After the edit, run:

```bash
sed -n '14,35p' README.vi.md
```

Expected: TOC has 18 rows, row 2 is the new `Chiến lược kinh doanh` row, all other rows are renumbered as above.

- [ ] **Step 2: Renumber the section headers**

For each old section header listed below, replace the leading `## N.` with `## N+1.`:

| Find                                   | Replace with                              |
| -------------------------------------- | ----------------------------------------- |
| `## 2. Phạm vi MVP`                    | `## 3. Phạm vi MVP`                       |
| `## 3. Kiến trúc hệ thống`             | `## 4. Kiến trúc hệ thống`                |
| `## 4. Luồng quét và tạo báo cáo`      | `## 5. Luồng quét và tạo báo cáo`         |
| `## 5. Rules engine và rubric tuân thủ` | `## 6. Rules engine và rubric tuân thủ`    |
| `## 6. LLM, RAG và xác minh kết quả`    | `## 7. LLM, RAG và xác minh kết quả`       |
| `## 7. Nguồn luật và quy trình quản trị corpus` | `## 8. Nguồn luật và quy trình quản trị corpus` |
| `## 8. Mô hình dữ liệu và quyền riêng tư` | `## 9. Mô hình dữ liệu và quyền riêng tư` |
| `## 9. API và giao diện người dùng`     | `## 10. API và giao diện người dùng`       |
| `## 10. Thiết kế giao diện`            | `## 11. Thiết kế giao diện`               |
| `## 11. Cấu trúc repository`           | `## 12. Cấu trúc repository`              |
| `## 12. Phát triển cục bộ`             | `## 13. Phát triển cục bộ`                |
| `## 13. Kiểm thử và quality gates`     | `## 14. Kiểm thử và quality gates`        |
| `## 14. Triển khai Cloudflare`         | `## 15. Triển khai Cloudflare`            |
| `## 15. Phát hành và rollback`         | `## 16. Phát hành và rollback`            |
| `## 16. Quy trình đóng góp`            | `## 17. Quy trình đóng góp`               |
| `## 17. Danh mục tài liệu nguồn`       | `## 18. Danh mục tài liệu nguồn`          |

After the edit, run:

```bash
grep -nE "^## [0-9]+\." README.vi.md
```

Expected: 18 lines, numbered 1..18 in order, no gaps, no duplicates. `## 1. Tổng quan sản phẩm` is unchanged; `## 2. Chiến lược kinh doanh` is the new section; everything from `## 3. Phạm vi MVP` onward is the renumbered set above.

- [ ] **Step 3: V2 full check — anchors resolve**

Verify every TOC anchor resolves to an actual section header slug:

```bash
# Pull anchors from TOC
grep -oE "#[0-9]+-[a-zà-ỹ0-9-]+" README.vi.md | sort -u > /tmp/toc_anchors.txt

# Pull slugs from headers (downcase + ascii-fold is needed for Vietnamese diacritics;
# since the README keeps diacritics literal in slugs, we compare directly).
grep -oE "^## [0-9]+\..*$" README.vi.md | \
  awk '{
    n=$2; sub(/\.$/,"",n);
    sub(/^## [0-9]+\. /,"");
    gsub(/ /,"-");
    print "#" n "-" tolower($0)
  }' | sort -u > /tmp/header_anchors.txt

diff /tmp/toc_anchors.txt /tmp/header_anchors.txt
```

Expected: empty diff. If non-empty, the TOC anchors and header slugs disagree — fix the mismatched row(s) before committing.

- [ ] **Step 4: Commit C2 — renumber**

```bash
cd /tmp/safelaunch-readme-biz-strategy
git add README.vi.md
git diff --cached --stat   # expect: 1 file changed, ~16-20 insertions, ~16-20 deletions (header text changes count as one line each; TOC swaps count as one line each)
git commit -m "docs(readme.vi): renumber §2-§17 to §3-§18 and update TOC

The §2 Chiến lược kinh doanh section was inserted in C1 ahead of
the renumbering step to keep the content commit atomic. This commit
shifts the existing §2-§17 to §3-§18 and updates the table of
contents accordingly.

Verified: 18 ## headers in order 1..18, TOC anchors match header
slugs, no body cross-references to old §N were broken (a pre-flight
grep confirmed only TOC rows carry §N references)."
```

Expected: one commit. Record its SHA.

---

### Task 8: Final verification V1–V5

**Files:**
- Read-only: `README.vi.md`.

- [ ] **Step 1: V1 — section integrity**

Confirm:

```bash
grep -nE "^## [0-9]+\." README.vi.md | wc -l   # expect: 18
grep -cE "^### " README.vi.md                   # expect: at least 26 (was ~22, +6 from §2.1-2.6 minus any existing sub-headers in §1 etc — exact baseline depends on the file, just confirm it GREW)
wc -l README.vi.md                              # expect: ~830-870 (was 710, +~120-160 for the new section)
```

Expected: 18 top-level headers, more `### ` headers than before, total lines grew by 100–160.

- [ ] **Step 2: V2 — cross-reference lint**

```bash
# No broken body references to old §N numbers (1-17 unchanged, 18 new is only in TOC)
grep -nE "§1[0-9]\b" README.vi.md
```

Expected: at most the row in §18 (renumbered §17) that references tài liệu đã công bố — i.e., no orphaned §1x references in the body that were meant for §3-§17. Skim any matches manually to confirm they reference source documents, not internal section numbers.

- [ ] **Step 3: V3 — anti-slop final lint**

```bash
# Scope to the new §2 to avoid false positives in unchanged sections.
sed -n '/^## 2\. Chiến lược kinh doanh/,/^## 3\. Phạm vi MVP/p' README.vi.md | \
  grep -nEi "dive into|cutting.edge|comprehensive solution|unlock the power|in today.s fast|coming soon|stay tuned|it's important to note"
```

Expected: zero matches. If any match, edit the offending sentence in §2 to remove the banned phrase; do not commit yet — re-run this step until clean.

- [ ] **Step 4: V4 — citation lint**

```bash
# Every literal path cited in §2 must exist in the repo (worktree-relative).
cd /tmp/safelaunch-readme-biz-strategy
for p in \
  apps/workers/src/services/quota-service.ts \
  apps/workers/src/services/redeem-codes.ts \
  apps/web/src/app/[locale]/admin/redeem-codes/page.tsx \
  packages/compliance-core/src/domain-key.ts \
  docs/compliance; do
  [ -e "$p" ] && echo "OK   $p" || echo "MISS $p"
done
```

Expected: all `OK`. If any `MISS`, the cited path has drifted — either fix the path in the README or stop and report that the spec needs an update.

- [ ] **Step 5: V5 — build green (conditional)**

V5 is required by `safelaunch-ai-workflow` Phase 4 step 11 even for doc-only changes. The doc-only worktree may not have `node_modules/` populated (it is a fresh `git worktree` split off from main). Run from the **main** worktree where the lockfile is already installed:

```bash
cd /Volumes/FX900/personal/safelaunch
pnpm -w build 2>&1 | tail -20
pnpm -w test  2>&1 | tail -20
```

Expected: both succeed. README change does not affect either. If either fails, the failure is pre-existing and unrelated to this PR — note it in the PR description and stop.

- [ ] **Step 6: Final commit (only if any V3/V4 fix was needed)**

If Steps 3 or 4 required an edit:

```bash
cd /tmp/safelaunch-readme-biz-strategy
git add README.vi.md
git diff --cached --stat
git commit -m "docs(readme.vi): post-verification fixes for §2

Fixes applied during V3 anti-slop and V4 citation linting:
<describe each fix in one short line>"
```

If no fix was needed, do not commit — the branch is already complete after C2.

- [ ] **Step 7: Confirm branch state**

```bash
cd /tmp/safelaunch-readme-biz-strategy
git log --oneline main..HEAD
git status --short
```

Expected: `git status --short` is clean. `git log` shows at least: (spec commit) → C1 → C2 → (optional final-fix commit).

---

## Out-of-scope (do NOT do in this plan)

- Do not translate §2 into English for `README.md`.
- Do not create a separate `docs/strategy.md`.
- Do not add pricing numbers, launch date, or competitor brand names.
- Do not touch any code, schema, migration, UI, message catalog, or test.
- Do not push to `origin` without explicit user instruction.
