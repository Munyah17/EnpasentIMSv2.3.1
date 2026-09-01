-- Adds policies.documents, matching the existing claims.documents /
-- tickets pattern — an array of Storage paths (see
-- database/add_document_storage.sql) for whatever was collected at
-- point of sale.
--
-- Run this once in the Supabase SQL Editor against the live database.

ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS documents TEXT[] NOT NULL DEFAULT '{}';
