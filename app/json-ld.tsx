// schema.org structured data for the page it is rendered on. A plain <script>
// rather than next/script — this is data for crawlers, not code to run.
//
// The "<" escape matters: listing names and descriptions are partners' own
// words, and a "</script>" in one would otherwise end the tag early.
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c"),
      }}
    />
  );
}
