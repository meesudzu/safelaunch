# ADMIN-03 — Usage metrics implementation plan

1. Add D1 fields and indexes for hashed hostnames and successful report opens.
2. Populate the fields in scan creation and report token burn paths.
3. Add a bounded aggregate endpoint for current and previous 24-hour windows.
4. Add `/admin/metrics`, shared navigation, tests, privacy inventory, and secret setup docs.
5. Run DB/Worker/Web tests, lint, typecheck, and builds.
