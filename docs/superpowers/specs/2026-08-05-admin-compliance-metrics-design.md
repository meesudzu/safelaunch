# ADMIN-06 — Compliance metrics design

## Mục tiêu

Cho reviewer quan sát phân bố kết quả compliance trong 7 ngày gần nhất mà không
biến dashboard vận hành thành tư vấn pháp lý hoặc làm lộ dữ liệu scan.

## Thiết kế

- `GET /v1/admin/metrics/compliance` tổng hợp findings theo severity và category.
- Severity dùng thứ tự rubric hiện hành: `pass`, `review`, `high`.
- Median category được tính trên ordinal severity và trả cùng tổng sample.
- Response kèm version của analysis run mới nhất để giải thích thay đổi rubric.
- Web dùng bảng HTML có caption/header thay cho chart chỉ truyền đạt bằng màu.

## Privacy và compliance

API chỉ trả aggregate và version metadata. Không trả raw URL, legal text,
finding detail, report token hoặc thông tin định danh. UI mô tả đây là số liệu
vận hành, không phải kết luận hay tư vấn pháp lý.

## Kiểm thử

Khóa cửa sổ 7 ngày, empty state, severity order, median category, version context
và rendering accessible của bảng.
