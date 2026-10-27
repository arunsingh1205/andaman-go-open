"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPartnerCommunityService } from "@/lib/partner-register";
import CommunityServiceFields, {
  communityDraftToInput,
  communityDraftValid,
  emptyCommunityDraft,
  type CommunityDraft,
} from "@/app/partner/(dashboard)/business/community-service-fields";
import { BackIcon } from "@/app/icons";

export default function CommunityForm({
  defaultIslandSlug,
  partnerId,
  admin = false,
  backHref = "/partner/business",
}: {
  defaultIslandSlug: string;
  /** Whose storage folder photos upload into — this business's own id, or
   *  (admin) the business an admin is adding this for (136). */
  partnerId: string;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CommunityDraft>(() => emptyCommunityDraft(defaultIslandSlug));
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const canSubmit = communityDraftValid(draft) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await addPartnerCommunityService(
      communityDraftToInput(draft),
      admin ? partnerId : undefined,
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
      <Link
        href={admin ? backHref : "/partner/business/new"}
        className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        {admin ? "Back" : "What are you adding?"}
      </Link>

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Add a community activity</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Free to join. People sign up with “I&apos;m interested” — no payment, no tickets.
      </p>

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
          {busy === "submit" ? "Adding…" : "Submit for review"}
        </button>
      </div>
    </>
  );
}
