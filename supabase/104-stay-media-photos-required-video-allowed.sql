-- ===========================================================================
-- Migration 104 — let the partner-photos bucket take video, for stays
--
-- The Stays wizard now requires at least one photo and lets a partner add a
-- short property walkthrough clip alongside their photos (lib/partner-storage.ts,
-- app/partner/(dashboard)/business/photo-gallery.tsx, gated behind an
-- allowVideo prop only the stay forms pass — every other listing type is
-- untouched). The bucket itself has to accept the mime types and the size
-- before any of that matters: it was image-only with no explicit size limit
-- (falling back to the project default), which is well under 100 MB.
--
-- Safe to run more than once.
-- ===========================================================================

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'],
    file_size_limit = 104857600
where id = 'partner-photos';

select 'partner-photos bucket now accepts video up to 100mb' as done;
