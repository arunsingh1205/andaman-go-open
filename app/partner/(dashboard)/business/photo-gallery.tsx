"use client";

// The photo picker every "add a listing" and "edit a listing" form shares.
//
// A listing can carry several photos now (LISTING_PHOTO_MAX), in an order the
// partner sets — the first one is the cover a traveller sees on the list. The
// upload itself still goes through uploadPartnerFile(), the same
// partner-id-scoped path the single-photo control used; this just does it in a
// loop and hands the parent an ordered array of storage paths.
//
// `onBusyChange` lets the parent keep its existing submit gate: it flips true
// while files are uploading and false when they're done.

import { useRef, useState } from "react";
import Image from "next/image";
import { uploadPartnerFile, partnerPhotoUrl, isVideoPath } from "@/lib/partner-storage";
import { LISTING_PHOTO_MAX } from "@/lib/photos";
import { CloseIcon, BackIcon, CameraIcon } from "@/app/icons";

const labelText = "text-[12px] font-bold text-muted";

export default function PhotoGallery({
  partnerId,
  value,
  onChange,
  onBusyChange,
  allowVideo = false,
  required = false,
}: {
  partnerId: string;
  value: string[];
  onChange: (paths: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Also accept a short video clip (up to 100 MB) alongside photos. */
  allowVideo?: boolean;
  /** Shows a hint that at least one photo is required — the actual gate lives in the parent form's own validation. */
  required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const room = LISTING_PHOTO_MAX - value.length;

  const onFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setProblem(null);
    setUploading(true);
    onBusyChange?.(true);

    const added: string[] = [];
    let skippedVideoBeforePhoto = false;
    const hasImageAlready = value.some((p) => !isVideoPath(p));

    for (const file of Array.from(files).slice(0, room)) {
      const isVideoFile = file.type.startsWith("video/");
      // The first item shown to travellers has to be a photo — a video can
      // only join once there is already at least one photo in the gallery,
      // so it never ends up as the cover by accident.
      if (isVideoFile && !hasImageAlready && !added.some((p) => !isVideoPath(p))) {
        skippedVideoBeforePhoto = true;
        continue;
      }
      const uploaded = await uploadPartnerFile("partner-photos", partnerId, file, { allowVideo });
      if (!uploaded.ok) {
        setProblem(uploaded.message);
        break;
      }
      added.push(uploaded.path);
    }

    if (added.length > 0) onChange([...value, ...added]);
    if (files.length > room) {
      setProblem(`Up to ${LISTING_PHOTO_MAX} photos — the extra ones weren't added.`);
    } else if (skippedVideoBeforePhoto) {
      setProblem("Add a photo first — the video wasn't added.");
    }

    setUploading(false);
    onBusyChange?.(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeAt = (i: number) => onChange(value.filter((_, n) => n !== i));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelText}>
        {allowVideo ? "Photos & video" : "Photos"} (the first one is the cover travellers see)
        {required && <span className="text-warn"> · at least one photo required</span>}
      </span>

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {value.map((path, i) => (
            <li
              key={path}
              className="relative aspect-square overflow-hidden rounded-xl border border-line bg-ground"
            >
              {isVideoPath(path) ? (
                <video src={partnerPhotoUrl(path)} className="h-full w-full object-cover" muted controls />
              ) : (
                <Image src={partnerPhotoUrl(path)} alt="" fill sizes="33vw" className="object-cover" />
              )}

              {i === 0 && (
                <span className="absolute top-1 left-1 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                  Cover
                </span>
              )}

              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => removeAt(i)}
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white"
              >
                <CloseIcon size={13} />
              </button>

              <div className="absolute inset-x-1 bottom-1 flex justify-between">
                <button
                  type="button"
                  aria-label="Move photo earlier"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white disabled:opacity-0"
                >
                  <BackIcon size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Move photo later"
                  disabled={i === value.length - 1}
                  onClick={() => move(i, 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white disabled:opacity-0"
                >
                  <BackIcon size={13} className="rotate-180" />
                </button>
              </div>
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
          {uploading
            ? "Uploading…"
            : value.length > 0
              ? "Add more"
              : allowVideo
                ? "Add photos or a video"
                : "Add photos"}
        </button>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={allowVideo ? "image/*,video/*" : "image/*"}
        multiple
        hidden
        onChange={(e) => onFilesChosen(e.target.files)}
      />
      {allowVideo && (
        <p className="text-[11px] font-medium text-muted">Videos up to 100 MB (MP4, MOV or WEBM).</p>
      )}

      {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}
    </div>
  );
}
