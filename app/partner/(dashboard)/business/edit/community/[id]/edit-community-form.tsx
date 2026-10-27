"use client";

// Mirrors business/new/community/community-form.tsx — same fields, prefilled
// from the row. Editing a listing that's already live sends it back for a
// quick recheck (the RPC decides, same as every other kind).

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updatePartnerCommunityService,
  type CommunityServiceDetail,
} from "@/lib/partner-register";
import { adminUpdateCommunityService } from "@/lib/admin-listing-edit";
import CommunityServiceFields, {
  communityDraftFrom,
  communityDraftToInput,
  communityDraftValid,
  type CommunityDraft,
} from "@/app/partner/(dashboard)/business/community-service-fields";
import { BackIcon } from "@/app/icons";

export default function EditCommunityForm({
  service,
  partnerId,
  admin = false,
  backHref = "/partner/business",
}: {
  service: CommunityServiceDetail;
  /** Whose storage folder photos upload into — this listing's own owner. */
  partnerId: string;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CommunityDraft>(() => communityDraftFrom(service));
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const canSubmit = communityDraftValid(draft) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await (admin ? adminUpdateCommunityService : updatePartnerCommunityService)(
      service.id,
      communityDraftToInput(draft),
    );
    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    router.push(backHref);
  };

  return (
    <>
      <Link href={backHref} className="flex items-center gap-1.5 text-[13px] font-bold text-muted">
        <BackIcon size={14} />
        {admin ? "Back" : "Business"}
      </Link>

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Edit community activity</h2>

      <div className="mt-5 flex flex-col gap-3">
        <CommunityServiceFields
          draft={draft}
          onChange={setDraft}
          partnerId={partnerId}
          onBusyChange={(b) => setBusy(b ? "photo" : null)}
        />

        {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="mt-2 h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy === "submit" ? "Saving…" : "Save changes"}
        </button>
      </div>
    </>
  );
}
