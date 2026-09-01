-- Insurer Management: which categories of cover an insurer partner
-- actually offers (life, funeral, health, accident, motor, property,
-- agriculture — same category set as products.category).
ALTER TABLE public.insurers ADD COLUMN IF NOT EXISTS cover_types TEXT[] NOT NULL DEFAULT '{}';

-- Agriculture claim assessment: a summary of what the farmer said verbally
-- on site, separate from the assessor's own remarks/comments.
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS farmer_statement TEXT;
