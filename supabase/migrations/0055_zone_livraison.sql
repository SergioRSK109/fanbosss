-- Delivery zone restriction for physical products (offre type
-- `produit`, migration 0039/0040/0041). A créateur selling a physical
-- product ships it themselves -- nothing in this app has ever stopped
-- a fan on the other side of the country (or the continent) from
-- paying for something the créateur never intended to ship that far.
-- This adds an opt-in scope: "my province only," "my whole country,"
-- or "no restriction" (the unchanged default).
--
-- See CLAUDE.md for why this is a 3-level scope rather than a fixed
-- list of provinces.

alter table users add column portee_livraison text
  check (portee_livraison in ('province', 'pays', 'aucune_restriction'));

-- NULL is the default for every existing row (this column has no
-- `default` clause) and stays NULL until a créateur actively picks a
-- scope in /parametres -- never retroactively restricting a créateur
-- who hasn't configured this yet, same "NULL = current, unrestricted
-- behavior" principle already used for masque_exploration/
-- classement_public elsewhere in this schema, just inverted (those
-- default to a concrete boolean; this one is genuinely three-way and a
-- 4th "not configured" state has to be NULL, not a 4th CHECK value).
