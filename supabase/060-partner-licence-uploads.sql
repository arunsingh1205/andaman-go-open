-- Partners couldn't upload their licence (2026-09-05).
--
-- 058-security-audit-fixes.sql gave both storage buckets an
-- allowed_mime_types list for the first time. That backstop is right, but it
-- was written against the *ideal* set of types rather than the ones phones
-- actually send, so uploads that used to work started failing with a 400:
--
--   * iPhone, picking the licence out of Files, sends image/heic.
--   * Several Android file managers send an empty type for a PDF, which
--     arrives at storage as application/octet-stream.
--   * A licence photographed and shared through WhatsApp can come back as
--     image/gif or a re-encoded jpeg with an odd label.
--
-- The client now resolves the real type from the file extension and stamps it
-- on the upload (lib/partner-storage.ts), so octet-stream no longer reaches
-- here. This widens the licence bucket to the rest of that list: a licence is
-- whatever the government issued — a PDF, or a picture of a piece of paper.
--
-- Photos (partner-photos) stay on jpeg/png/webp: those are traveller-facing
-- and rendered in the browser, so the narrow list is deliberate there.

update storage.buckets
set allowed_mime_types = array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/gif'
    ],
    -- A multi-page scan of a dive-shop licence clears 8 MB easily. Matches
    -- MAX_LICENSE_BYTES in lib/partner-storage.ts, so the client rejects an
    -- oversized file with a readable message before storage ever sees it.
    file_size_limit = 15728640
where id = 'partner-licenses';


select 'partner licence uploads widened' as done;
