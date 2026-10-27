"use client";

// The Business tab: what Andaman Go knows about this partner, what they've
// submitted, and how to add more. Two review gates show up here honestly —
// the business itself (top banner) and each individual listing below it —
// because a partner who doesn't understand why their new activity isn't
// bookable yet will assume something broke.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  resubmitPartner,
  updatePartnerProfile,
  type OwnBusiness,
  type OwnListing,
  type RentalHour,
} from "@/lib/partner-register";
import { KIND_NEEDS_LICENSE, PARTNER_KIND_LABEL } from "@/lib/partner-kind";
import { uploadPartnerFile, partnerPhotoUrl } from "@/lib/partner-storage";
import RentalHoursEditor from "./rental-hours-fields";
import { ChevronIcon, CheckIcon, ClockIcon, PlusIcon } from "@/app/icons";

export default function BusinessView({
  business,
  listings,
  rentalHours,
}: {
  business: OwnBusiness;
  listings: OwnListing[];
  rentalHours: RentalHour[];
}) {
  const router = useRouter();
  const [area, setArea] = useState(business.area ?? "");
  const [address, setAddress] = useState(business.address ?? "");
  const [mapsUrl, setMapsUrl] = useState(business.mapsUrl ?? "");
  const [licenseNumber, setLicenseNumber] = useState(business.licenseNumber ?? "");
  const [coverPhotoPath, setCoverPhotoPath] = useState(business.coverPhotoPath);
  const [licenseDocPath, setLicenseDocPath] = useState(business.licenseDocPath);
  const [busy, setBusy] = useState<"cover" | "license-doc" | "details" | "resubmit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const coverInput = useRef<HTMLInputElement>(null);
  const licenseInput = useRef<HTMLInputElement>(null);

  const needsLicense = KIND_NEEDS_LICENSE[business.kind] === true;

  const save = async (next: {
    coverPhotoPath?: string | null;
    licenseDocPath?: string | null;
  }) => {
    setProblem(null);
    const result = await updatePartnerProfile({
      area,
      address,
      mapsUrl,
      licenseNumber,
      coverPhotoPath: next.coverPhotoPath !== undefined ? next.coverPhotoPath : coverPhotoPath,
      licenseDocPath: next.licenseDocPath !== undefined ? next.licenseDocPath : licenseDocPath,
    });
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    return true;
  };

  const onCoverChosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy("cover");
    setProblem(null);
    if (coverInput.current) coverInput.current.value = "";
    const uploaded = await uploadPartnerFile("partner-photos", business.id, file);
    if (!uploaded.ok) {
      setProblem(uploaded.message);
      setBusy(null);
      return;
    }
    setCoverPhotoPath(uploaded.path);
    await save({ coverPhotoPath: uploaded.path });
    setBusy(null);
  };

  const onLicenseChosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy("license-doc");
    setProblem(null);
    // Clearing the input means picking the *same* file again still fires a
    // change event. Without this, a partner whose first attempt failed taps
    // the same document a second time and nothing at all happens.
    if (licenseInput.current) licenseInput.current.value = "";
    const uploaded = await uploadPartnerFile("partner-licenses", business.id, file);
    if (!uploaded.ok) {
      setProblem(uploaded.message);
      setBusy(null);
      return;
    }
    setLicenseDocPath(uploaded.path);
    await save({ licenseDocPath: uploaded.path });
    setBusy(null);
  };

  const saveDetails = async () => {
    setBusy("details");
    const ok = await save({});
    setBusy(null);
    if (ok) router.refresh();
  };

  const resubmitBusiness = async () => {
    setBusy("resubmit");
    setProblem(null);
    const result = await resubmitPartner();
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight desk:text-[24px]">
        {business.name}
      </h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">{PARTNER_KIND_LABEL[business.kind]}</p>

      <StatusBanner
        status={business.status}
        rejectionReason={business.rejectionReason}
        onResubmit={resubmitBusiness}
        resubmitting={busy === "resubmit"}
      />

      <div className="desk:grid desk:grid-cols-[1.1fr_1fr] desk:gap-8 desk:items-start">
      <div className="desk:rounded-2xl desk:border desk:border-line desk:bg-surface desk:p-5 desk:shadow-sm">
      <section className="mt-5">
        <p className="text-[12px] font-bold text-muted">Cover photo</p>
        <p className="mt-0.5 text-[11.5px] font-medium text-muted">
          What a traveller sees first — make it your shop front or your best shot on the water.
        </p>
        <div className="mt-2 flex items-center gap-3">
          {coverPhotoPath ? (
            <Image
              src={partnerPhotoUrl(coverPhotoPath)}
              alt="Cover"
              width={64}
              height={64}
              className="h-16 w-16 rounded-xl border border-line object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-line text-[10px] font-medium text-muted">
              No photo
            </span>
          )}
          <button
            type="button"
            disabled={busy === "cover"}
            onClick={() => coverInput.current?.click()}
            className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
          >
            {busy === "cover" ? "Uploading…" : coverPhotoPath ? "Replace photo" : "Add photo"}
          </button>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onCoverChosen(e.target.files?.[0])}
          />
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 border-t border-hairline pt-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-muted">Area</span>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Aberdeen Bazaar"
            className="h-11 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand"
          />
          <p className="text-[11px] font-medium text-muted">
            Where you actually are — shown on your card so travellers can find something nearby first.
          </p>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-muted">Address</span>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] font-semibold outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-muted">Google Maps link</span>
          <input
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="Paste a Google Maps share link"
            className="h-11 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand"
          />
        </label>
      </section>

      <section className="mt-4 border-t border-hairline pt-4">
        <p className="text-[12px] font-bold text-muted">
          Licence {needsLicense ? "— required for your category" : "(optional)"}
        </p>
        <input
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
          placeholder="Licence number"
          className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={busy === "license-doc"}
            onClick={() => licenseInput.current?.click()}
            className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
          >
            {busy === "license-doc" ? "Uploading…" : licenseDocPath ? "Replace document" : "Upload document"}
          </button>
          {licenseDocPath && <span className="text-[12px] font-medium text-muted">Uploaded ✓</span>}
          {/* The extensions are listed alongside the MIME types on purpose:
              some Android pickers match on one and some on the other, and a
              picker that hides the partner's PDF looks like a broken upload. */}
          <input
            ref={licenseInput}
            type="file"
            accept="application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
            hidden
            onChange={(e) => onLicenseChosen(e.target.files?.[0])}
          />
        </div>
        <p className="mt-2 text-[12px] font-medium text-muted">
          PDF or a clear photo (JPG, PNG, WEBP or HEIC), up to 15 MB.
        </p>
      </section>

      {problem && <p className="mt-3 text-[12.5px] font-medium text-warn">{problem}</p>}

      <button
        type="button"
        disabled={busy === "details"}
        onClick={saveDetails}
        className="mt-4 h-12 w-full rounded-xl bg-brand text-[13.5px] font-bold text-white disabled:opacity-60"
      >
        {busy === "details" ? "Saving…" : saved ? "Saved ✓" : "Save details"}
      </button>

      {business.kind === "rental" && <RentalHoursEditor initial={rentalHours} />}

      <CancellationPolicy business={business} />
      </div>

      <div className="desk:rounded-2xl desk:border desk:border-line desk:bg-surface desk:p-5 desk:shadow-sm">
      <div className="mt-7 flex items-center justify-between border-t border-hairline pt-4 desk:mt-0 desk:border-t-0 desk:pt-0">
        <h3 className="text-[15px] font-bold">My listings</h3>
        <Link
          href="/partner/business/new"
          className="flex items-center gap-1 rounded-full bg-brandsoft px-3 py-1.5 text-[12px] font-bold text-brand"
        >
          <PlusIcon size={12} />
          Add a listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <p className="mt-4 text-[13px] font-medium text-muted">
          Nothing added yet. Add your first activity, rental or room to get started.
        </p>
      ) : (
        <Link
          href="/partner/listings"
          className="mt-3 flex items-center justify-between rounded-[18px] border border-line bg-surface p-4 desk:rounded-xl"
        >
          <div>
            <p className="text-[14px] font-bold text-ink">
              {listings.length} listing{listings.length === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 text-[11.5px] font-medium text-muted">
              {listings.filter((l) => l.isListed).length} live
              {listings.some((l) => l.rejectionReason)
                ? ` · ${listings.filter((l) => l.rejectionReason).length} need attention`
                : ""}
            </p>
          </div>
          <ChevronIcon size={16} className="text-muted" />
        </Link>
      )}
      </div>
      </div>
    </>
  );
}

function StatusBanner({
  status,
  rejectionReason,
  onResubmit,
  resubmitting,
}: {
  status: OwnBusiness["status"];
  rejectionReason: string | null;
  onResubmit: () => void;
  resubmitting: boolean;
}) {
  if (status === "approved") {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-[16px] bg-brandsoft px-3.5 py-2.5 text-[12.5px] font-bold text-brand desk:rounded-xl">
        <CheckIcon size={14} />
        Approved — your listed items can appear on Andaman Go.
      </div>
    );
  }
  if (status === "suspended") {
    return (
      <div className="mt-3 rounded-[16px] bg-sandsoft px-3.5 py-2.5 text-[12.5px] font-bold text-warn desk:rounded-xl">
        Suspended — contact Andaman Go before adding anything new.
      </div>
    );
  }
  if (status === "deleted") {
    return (
      <div className="mt-3 rounded-[16px] bg-sandsoft px-3.5 py-2.5 text-[12.5px] font-bold text-warn desk:rounded-xl">
        <p>Removed{rejectionReason ? `: ${rejectionReason}` : "."}</p>
        <p className="mt-1 text-[11.5px] font-medium text-sandink2">
          Andaman Go has taken this business off the app. Contact Andaman Go if you think this
          isn&apos;t right — there is no resubmitting it yourself.
        </p>
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="mt-3 rounded-[16px] bg-sandsoft px-3.5 py-2.5 text-[12.5px] font-bold text-warn desk:rounded-xl">
        <p>Not approved{rejectionReason ? `: ${rejectionReason}` : "."}</p>
        <p className="mt-1 text-[11.5px] font-medium text-sandink2">
          Update your details below, then send it back for another look.
        </p>
        <button
          type="button"
          disabled={resubmitting}
          onClick={onResubmit}
          className="mt-2 h-9 rounded-lg bg-warn px-3.5 text-[12px] font-bold text-white disabled:opacity-60"
        >
          {resubmitting ? "Sending…" : "Resubmit for review"}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-2 rounded-[16px] bg-sandsoft px-3.5 py-2.5 text-[12.5px] font-bold text-sandink2 desk:rounded-xl">
      <ClockIcon size={14} />
      Pending review — you can keep adding listings while Andaman Go checks your details.
    </div>
  );
}

function CancellationPolicy({ business }: { business: OwnBusiness }) {
  const pct = business.commissionBps != null ? business.commissionBps / 100 : null;
  return (
    <section className="mt-5 border-t border-hairline pt-4">
      <p className="text-[12px] font-bold text-muted">Cancellation policy</p>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        Andaman Go runs one policy across every partner, so travellers always know where they stand
        {pct != null && ` — your deposit is ${pct}%, your own agreed commission rate`}:
      </p>
      <ul className="mt-2.5 flex flex-col gap-2">
        <li className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3">
          <span className="text-[13px] font-bold text-ink">
            Paid {pct != null ? `a ${pct}% deposit` : "a deposit"}
          </span>
          <span className="mt-0.5 block text-[11.5px] font-medium text-muted">
            The deposit is non-refundable if the traveller cancels or doesn&apos;t show. Nothing was
            delivered, so it stays with Andaman Go — none of it comes to you.
          </span>
        </li>
        <li className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3">
          <span className="text-[13px] font-bold text-ink">Paid in full</span>
          <span className="mt-0.5 block text-[11.5px] font-medium text-muted">
            50% is refunded if they cancel more than 24 hours before the start, nothing after that.
            Whatever&apos;s kept stays with Andaman Go — nothing further comes to you.
          </span>
        </li>
        <li className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3">
          <span className="text-[13px] font-bold text-ink">You cancel a booking</span>
          <span className="mt-0.5 block text-[11.5px] font-medium text-muted">
            The traveller is refunded in full. Use it only when you genuinely can&apos;t run it.
          </span>
        </li>
      </ul>
    </section>
  );
}
