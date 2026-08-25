-- Apartment Quest — seed the four people. Idempotent.
insert into people (key, name, color, annual_income) values
  ('dylan',   'Dylan',   '#2563eb', 0),
  ('reese',   'Reese',   '#db2777', 0),
  ('brenna',  'Brenna',  '#16a34a', 0),
  ('kathryn', 'Kathryn', '#f59e0b', 0)
on conflict (key) do nothing;
