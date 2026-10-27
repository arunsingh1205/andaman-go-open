"use client";

// The ops-onboarding equivalent of app/partner/(dashboard)/business/photo-gallery.tsx
// — same grid-with-remove UX, but uploads through uploadOpsPartnerPhoto
// (service-role, see photo-upload.ts) instead of the partner's own browser
// session, since ops isn't linked to the partner it just created.

import { useRef, useState } from "react";
import Image from "next/image";
import { listingPhotoUrl } from "@/lib/photos";
import { uploadOpsPartnerPhoto } from "./photo-upload";
import { CloseIcon, CameraIcon } from "@/app/icons";

const labelText = "text-[12px] font-bold text-muted";

export default function OpsPhotoPicker({
  partnerId,
  value,
  onChange,
  max,
  label,
}: {
  partnerId: string;
  value: string[];
  onChange: (paths: string[]) => void;
  /** 1 for a single cover photo, LISTING_PHOTO_MAX for a listing gallery. */
  max: number;
  label: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const room = max - value.length;

  const onFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setProblem(null);
    setUploading(true);

    const added: string[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      const result = await uploadOpsPartnerPhoto(partnerId, file);
      if (!result.ok) {
        setProblem(result.message);
        break;
      }
      added.push(result.path);
    }

    if (added.length > 0) onChange([...value, ...added]);
    if (files.length > room) {
      setProblem(`Up to ${max} photo${max === 1 ? "" : "s"} — the extra ones weren't added.`);
    }

    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeAt = (i: number) => onChange(value.filter((_, n) => n !== i));

  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelText}>{label}</span>

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {value.map((path, i) => (
            <li
              key={path}
              className="relative aspect-square overflow-hidden rounded-xl border border-line bg-ground"
            >
              <Image src={listingPhotoUrl(path)} alt="" fill sizes="33vw" className="object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => removeAt(i)}
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white"
              >
                <CloseIcon size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {room > 0 && (
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="flex h-10 items-center gap-2 self-start rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
        >
          <CameraIcon size={15} />
          {uploading ? "Uploading…" : value.length > 0 ? "Add more" : "Add photos"}
        </button>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple={max > 1}
        hidden
        onChange={(e) => onFilesChosen(e.target.files)}
      />

      {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}
    </div>
  );
}
