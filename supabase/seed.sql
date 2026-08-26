-- Apartment Quest — seed the four people. Idempotent.
-- Colours are the "Dusk Candy" roster palette and are load-bearing UI: every
-- listing border, vote circle and chat bubble is drawn from people.color.
insert into people (key, name, color, annual_income) values
  ('dylan',   'Dylan',   '#ffd56b', 0),
  ('reese',   'Reese',   '#ff9ecf', 0),
  ('brenna',  'Brenna',  '#9df0b5', 0),
  ('kathryn', 'Kathryn', '#c4a8ff', 0)
on conflict (key) do nothing;
