"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPartnerTrip } from "@/lib/partner-register";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import TripScheduleFields, {
  emptyTripSchedule,
  tripScheduleToArgs,
  tripScheduleValid,
  type TripSchedule,
} from "@/app/partner/(dashboard)/business/trip-schedule-fields";
import TripMeetingFields, {
  meetingValid,
} from "@/app/partner/(dashboard)/business/trip-meeting-fields";
import { BackIcon } from "@/app/icons";

const DIFFICULTIES: { value: "easy" | "moderate" | "challenging"; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "challenging", label: "Challenging" },
];

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function TripForm({
  partnerId,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  /** An admin adding this for the business (136) — see activity-form.tsx. */
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState("");
  const [hostSince, setHostSince] = useState("");
  const [durationLabel, setDurationLabel] = useState("Full day");
  const [schedule, setSchedule] = useState<TripSchedule>(() => emptyTripSchedule());
  const [priceRupees, setPriceRupees] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "moderate" | "challenging">("moderate");
  const [minSeats, setMinSeats] = useState("1");
  const [seatsTotal, setSeatsTotal] = useState("");
  const [summary, setSummary] = useState("");
  const [includesText, setIncludesText] = useState("");
  const [bringText, setBringText] = useState("");
  const [meetPoint, setMeetPoint] = useState("");
  const [meetAtHotel, setMeetAtHotel] = useState(false);
  const [mapsUrl, setMapsUrl] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const price = Math.round(parseFloat(priceRupees || "0") * 100);
  const minSeatsNum = parseInt(minSeats || "0", 10);
  const seatsTotalNum = seatsTotal.trim() === "" ? null : parseInt(seatsTotal, 10);

  const canSubmit =
    title.trim() !== "" &&
    hostName.trim() !== "" &&
    meetingValid(meetAtHotel, meetPoint) &&
    priceRupees.trim() !== "" &&
    !isNaN(price) &&
    price >= 0 &&
    (seatsTotalNum === null || seatsTotalNum >= 1) &&
    minSeatsNum >= 1 &&
    (seatsTotalNum === null || minSeatsNum <= seatsTotalNum) &&
    tripScheduleValid(schedule) &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const includes = includesText
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a !== "");
    const bringList = bringText
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a !== "");

    const result = await addPartnerTrip(
      {
        title,
        hostName,
        hostSince,
        durationLabel,
        ...tripScheduleToArgs(schedule),
        pricePaise: price,
        difficulty,
        minSeats: minSeatsNum,
        seatsTotal: seatsTotalNum,
        summary,
        includes,
        bringList,
        meetPoint,
        meetAtHotel,
        mapsUrl,
        photoPaths,
      },
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Add a day trip</h2>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Trip title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jungle Trek" className={inputClass} />
        </label>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Host name</span>
            <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Suresh" className={inputClass} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Hosting since (optional)</span>
            <input value={hostSince} onChange={(e) => setHostSince(e.target.value)} placeholder="2019" className={inputClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Duration</span>
          <input
            value={durationLabel}
            onChange={(e) => setDurationLabel(e.target.value)}
            placeholder="Full day"
            className={inputClass}
          />
        </label>

        <TripScheduleFields schedule={schedule} onChange={setSchedule} />

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Price per seat (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            value={priceRupees}
            onChange={(e) => setPriceRupees(e.target.value)}
            placeholder="2000"
            className={inputClass}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={labelText}>Difficulty</span>
          <div className="flex flex-wrap gap-1.5">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDifficulty(d.value)}
                className={`h-9 rounded-lg px-3 text-[12.5px] font-bold ${
                  difficulty === d.value ? "bg-brand text-white" : "border border-line bg-surface text-muted"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Minimum seats to run</span>
            <input
              type="number"
              inputMode="numeric"
              value={minSeats}
              onChange={(e) => setMinSeats(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Total seats — optional</span>
            <input
              type="number"
              inputMode="numeric"
              value={seatsTotal}
              onChange={(e) => setSeatsTotal(e.target.value)}
              placeholder="Leave blank for no limit"
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Summary</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={areaClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>What&apos;s included (comma separated, optional)</span>
          <input
            value={includesText}
            onChange={(e) => setIncludesText(e.target.value)}
            placeholder="Lunch, Guide, Transport"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>What to bring (comma separated, optional)</span>
          <input
            value={bringText}
            onChange={(e) => setBringText(e.target.value)}
            placeholder="Water shoes, Sunscreen, Change of clothes"
            className={inputClass}
          />
        </label>

        <TripMeetingFields
          meetAtHotel={meetAtHotel}
          meetPoint={meetPoint}
          mapsUrl={mapsUrl}
          onChange={(next) => {
            setMeetAtHotel(next.meetAtHotel);
            setMeetPoint(next.meetPoint);
            setMapsUrl(next.mapsUrl);
          }}
        />

        <PhotoGallery
          partnerId={partnerId}
          value={photoPaths}
          onChange={setPhotoPaths}
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
