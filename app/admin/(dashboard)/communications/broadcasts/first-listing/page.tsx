import { PageHeader } from "../../../admin-ui";
import FirstListingEmailView from "./first-listing-view";

export const dynamic = "force-dynamic";

export default function AdminFirstListingEmailPage() {
  return (
    <>
      <PageHeader
        title="First-listing email"
        subtitle="Sent automatically the moment a partner adds their first listing (any category), regardless of approval status. The commission table here has to match public/partner-brochure.pdf — edit both together in code, not from this page."
      />
      <FirstListingEmailView />
    </>
  );
}
