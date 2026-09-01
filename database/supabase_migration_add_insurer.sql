-- ================================================================
-- MIGRATION: Add insurer column to clients and policies tables
-- Run this in your Supabase SQL Editor
-- Project: https://iovcahedkzxobdgfkdwg.supabase.co
-- ================================================================

-- Add insurer column to clients table
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS insurer TEXT;

-- Add insurer column to policies table
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS insurer TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.clients.insurer IS 'Insurance company providing coverage for this client';
COMMENT ON COLUMN public.policies.insurer IS 'Insurance company underwriting this policy';
