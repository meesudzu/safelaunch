-- SafeLaunch MVP seed: 4 legal documents + 12 provisions covering the
-- 4 rubric rules (R-PRIV-1, R-OPID-1, R-CONT-1, R-LIC-1).
-- Status: 'approved' (already reviewed). Effective from 2025-01-01.
-- Insert legal_documents first (FK from legal_provisions).

INSERT INTO legal_documents (id, jurisdiction, source_url, title, status, retrieved_at, effective_from, effective_to, source_hash) VALUES
  ('doc-pd-13-2023', 'VN',
   'https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=210924',
   'Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân',
   'approved', '2026-07-29T00:00:00.000Z', '2023-07-01', NULL,
   'sha256-pd-13-2023-v1'),

  ('doc-pd-72-2013', 'VN',
   'https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=18370',
   'Nghị định 72/2013/NĐ-CP về quản lý dịch vụ trò chơi điện tử',
   'approved', '2026-07-29T00:00:00.000Z', '2013-09-15', NULL,
   'sha256-pd-72-2013-v1'),

  ('doc-law-attm-2015', 'VN',
   'https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=25914',
   'Luật An toàn thông tin mạng 2015',
   'approved', '2026-07-29T00:00:00.000Z', '2016-07-01', NULL,
   'sha256-law-attm-2015-v1'),

  ('doc-pd-72-2013-license', 'VN',
   'https://vbpl.vn/TW/Pages/vbpq-thuoctinhluoc.do?itemId=18370',
   'Nghị định 72/2013/NĐ-CP — Phụ lục về giấy phép phát hành trò chơi',
   'approved', '2026-07-29T00:00:00.000Z', '2013-09-15', NULL,
   'sha256-pd-72-2013-license-v1');

-- Now legal_provisions. The provision_id below matches the citation IDs
-- declared in docs/compliance/rubrics/v1.md so the worker evaluator can
-- reference them directly.

-- Nghị định 13/2023/NĐ-CP (R-PRIV-1)
INSERT INTO legal_provisions (id, document_id, article, clause, text, vector_id, categories_json) VALUES
  ('vn-pd-2025-privacy-notice', 'doc-pd-13-2023', '13', NULL,
   'Tổ chức, cá nhân xử lý dữ liệu cá nhân phải thông báo cho chủ thể dữ liệu về mục đích, phạm vi xử lý trước khi tiến hành xử lý. Hình thức thông báo phải rõ ràng, dễ tiếp cận.',
   NULL, '["online_game","electronic_press","digital_entertainment"]'),
  ('prov-pd13-art14', 'doc-pd-13-2023', '14', NULL,
   'Chính sách bảo vệ dữ liệu cá nhân phải được công khai trên website hoặc ứng dụng của tổ chức, cá nhân xử lý dữ liệu cá nhân.',
   NULL, '["online_game","electronic_press","digital_entertainment"]'),
  ('prov-pd13-art20', 'doc-pd-13-2023', '20', NULL,
   'Tổ chức, cá nhân xử lý dữ liệu cá nhân phải bảo đảm an toàn thông tin và có biện pháp bảo vệ dữ liệu cá nhân phù hợp.',
   NULL, '["online_game","electronic_press","digital_entertainment"]');

-- Nghị định 72/2013/NĐ-CP (R-OPID-1)
INSERT INTO legal_provisions (id, document_id, article, clause, text, vector_id, categories_json) VALUES
  ('vn-pd-2025-operator-identity', 'doc-pd-72-2013', '4', NULL,
   'Doanh nghiệp cung cấp dịch vụ trò chơi điện tử phải công khai tên, địa chỉ, số điện thoại liên hệ trên trang thông tin điện tử của mình.',
   NULL, '["online_game"]'),
  ('prov-pd72-art5', 'doc-pd-72-2013', '5', NULL,
   'Doanh nghiệp phải cung cấp đầy đủ thông tin về đơn vị vận hành, bao gồm tên pháp lý, địa chỉ trụ sở, mã số doanh nghiệp và người đại diện theo pháp luật.',
   NULL, '["online_game"]'),
  ('prov-pd72-art6', 'doc-pd-72-2013', '6', NULL,
   'Trang thông tin điện tử của doanh nghiệp phải có mục Giới thiệu (About) với đầy đủ thông tin đơn vị vận hành và người chịu trách nhiệm nội dung.',
   NULL, '["online_game"]');

-- Luật An toàn thông tin mạng 2015 (R-CONT-1)
INSERT INTO legal_provisions (id, document_id, article, clause, text, vector_id, categories_json) VALUES
  ('vn-pd-2025-contact-channel', 'doc-law-attm-2015', '17', NULL,
   'Doanh nghiệp cung cấp dịch vụ trên mạng phải công khai thông tin liên hệ bao gồm địa chỉ, số điện thoại và email để người sử dụng liên hệ khi cần.',
   NULL, '["online_game","electronic_press","digital_entertainment"]'),
  ('prov-law-attm-art18', 'doc-law-attm-2015', '18', NULL,
   'Đơn vị vận hành phải bố trí kênh liên hệ thường trực và phản hồi trong vòng 24 giờ đối với các yêu cầu về an toàn thông tin.',
   NULL, '["online_game","electronic_press","digital_entertainment"]'),
  ('prov-law-attm-art19', 'doc-law-attm-2015', '19', NULL,
   'Việc tiếp nhận phản ánh của người sử dụng phải được ghi nhận và xử lý theo quy trình nội bộ đã công bố.',
   NULL, '["online_game","electronic_press","digital_entertainment"]');

-- Nghị định 72/2013/NĐ-CP — Giấy phép phát hành (R-LIC-1)
INSERT INTO legal_provisions (id, document_id, article, clause, text, vector_id, categories_json) VALUES
  ('vn-pd-72-2013-game-license', 'doc-pd-72-2013-license', '21', NULL,
   'Doanh nghiệp cung cấp dịch vụ trò chơi điện tử phải có giấy phép phát hành trò chơi còn hiệu lực do cơ quan có thẩm quyền cấp.',
   NULL, '["online_game"]'),
  ('prov-pd72-art22', 'doc-pd-72-2013-license', '22', NULL,
   'Giấy phép phát hành phải được công khai trên trang thông tin điện tử của doanh nghiệp, bao gồm số giấy phép, ngày cấp, ngày hết hạn và cơ quan cấp.',
   NULL, '["online_game"]'),
  ('prov-pd72-art23', 'doc-pd-72-2013-license', '23', NULL,
   'Trường hợp giấy phép hết hạn hoặc bị thu hồi, doanh nghiệp phải ngừng cung cấp dịch vụ trong vòng 24 giờ.',
   NULL, '["online_game"]');

-- Audit events marking each doc as approved by reviewer
INSERT INTO legal_review_events (id, document_id, actor, decision, reason, created_at) VALUES
  ('evt-seed-pd13', 'doc-pd-13-2023', 'seed-script@safelaunch.test', 'approve',
   'MVP seed: cited by rubric v1 R-PRIV-1 (vn-pd-2025-privacy-notice).',
   '2026-07-29T00:00:00.000Z'),
  ('evt-seed-pd72', 'doc-pd-72-2013', 'seed-script@safelaunch.test', 'approve',
   'MVP seed: cited by rubric v1 R-OPID-1 (vn-pd-2025-operator-identity).',
   '2026-07-29T00:00:00.000Z'),
  ('evt-seed-attm', 'doc-law-attm-2015', 'seed-script@safelaunch.test', 'approve',
   'MVP seed: cited by rubric v1 R-CONT-1 (vn-pd-2025-contact-channel).',
   '2026-07-29T00:00:00.000Z'),
  ('evt-seed-pd72-license', 'doc-pd-72-2013-license', 'seed-script@safelaunch.test', 'approve',
   'MVP seed: cited by rubric v1 R-LIC-1 (vn-pd-72-2013-game-license).',
   '2026-07-29T00:00:00.000Z');

-- One rule_version row so analysis_runs can reference it later
INSERT INTO rule_versions (id, rubric_hash, created_at) VALUES
  ('rv-vn-mvp-v1', 'vn-mvp-v1-rubric-2026-07-30', '2026-07-30T00:00:00.000Z');
