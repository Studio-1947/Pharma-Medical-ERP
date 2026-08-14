-- Seed the default billing flow: the patient-first counter desk is the
-- default experience for shop managers. The row is also created lazily by the
-- settings service (defaults to "new" when absent), but seeding it keeps the
-- very first boot consistent with the setting UI.
INSERT INTO "app_settings" ("key", "value", "updated_at")
VALUES ('billing_flow', '{"flow":"new"}', now())
ON CONFLICT ("key") DO NOTHING;
