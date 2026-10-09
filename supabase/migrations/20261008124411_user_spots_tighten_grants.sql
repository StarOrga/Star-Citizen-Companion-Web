-- Default privileges gave authenticated TRUNCATE/REFERENCES/TRIGGER; TRUNCATE bypasses RLS.
revoke truncate, references, trigger on table public.user_spots from authenticated;
