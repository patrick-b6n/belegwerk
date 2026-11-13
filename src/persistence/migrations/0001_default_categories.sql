-- Default categories (#13). Data only; never edit once released (the migrator
-- hashes applied migrations). Positions are keys of EUER_POSITIONS
-- (src/business/euer/positions.ts); is_system = 1 marks the categories the
-- EÜR depends on (VAT payments/refunds, Erlösminderung).
INSERT INTO `categories` (`name`, `type`, `euer_position`, `reduces_income`, `archived`, `is_system`) VALUES
  ('Umsatzerlöse', 'income', 'BETRIEBSEINNAHMEN_UST_PFLICHTIG', 0, 0, 0),
  ('Steuerfreie / nicht steuerbare Erlöse', 'income', 'BETRIEBSEINNAHMEN_UST_FREI', 0, 0, 0),
  ('USt-Erstattung', 'income', 'UST_ERSTATTUNG', 0, 0, 1),
  ('Fremdleistungen', 'expense', 'FREMDLEISTUNGEN', 0, 0, 0),
  ('Geringwertige Wirtschaftsgüter (GWG)', 'expense', 'GWG', 0, 0, 0),
  ('Miete Geschäftsräume', 'expense', 'MIETE_GESCHAEFTSRAEUME', 0, 0, 0),
  ('Telefon / Internet', 'expense', 'TELEKOMMUNIKATION', 0, 0, 0),
  ('Übernachtung / Reisenebenkosten', 'expense', 'REISENEBENKOSTEN', 0, 0, 0),
  ('Verpflegungsmehraufwand', 'expense', 'VERPFLEGUNGSMEHRAUFWAND', 0, 0, 0),
  ('Fahrtkosten', 'expense', 'FAHRTKOSTEN', 0, 0, 0),
  ('Fortbildung', 'expense', 'FORTBILDUNG', 0, 0, 0),
  ('Rechts- und Steuerberatung, Buchführung', 'expense', 'RECHTS_STEUERBERATUNG', 0, 0, 0),
  ('Beiträge / Versicherungen', 'expense', 'BEITRAEGE_VERSICHERUNGEN', 0, 0, 0),
  ('EDV-Kosten / Software', 'expense', 'EDV_KOSTEN', 0, 0, 0),
  ('Bürobedarf / Porto / Fachliteratur', 'expense', 'ARBEITSMITTEL', 0, 0, 0),
  ('Werbung', 'expense', 'WERBUNG', 0, 0, 0),
  ('Bewirtung', 'expense', 'BEWIRTUNG', 0, 0, 0),
  ('Bank- und Zahlungsgebühren', 'expense', 'SONSTIGE_AUSGABEN', 0, 0, 0),
  ('Sonstige Betriebsausgaben', 'expense', 'SONSTIGE_AUSGABEN', 0, 0, 0),
  ('USt-Vorauszahlung', 'expense', 'UST_AN_FA', 0, 0, 1),
  ('Erlösminderung / Rückerstattung', 'expense', 'BETRIEBSEINNAHMEN_UST_PFLICHTIG', 1, 0, 1);
