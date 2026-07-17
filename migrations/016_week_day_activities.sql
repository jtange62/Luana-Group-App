-- Daily sub-themes also plan that day's activities (Summer School).
ALTER TABLE week_days ADD COLUMN activities TEXT;  -- one per line or comma separated
