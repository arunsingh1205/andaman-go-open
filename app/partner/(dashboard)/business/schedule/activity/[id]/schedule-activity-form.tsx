"use client";

// Sets an activity's timetable (activity_schedule) directly. A new activity now
// already carries its times from the "Add an activity" form, so this screen is
// mostly for changing hours later. The slot editor itself lives in
// ../../activity-schedule-fields.tsx, shared with that form.
//
// See 017-partner-schedule-editor.sql: unlike every other partner-facing edit,
// saving here does NOT send the listing back for review — hours and capacity
// are operational, not content Andaman Go re-reviews.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setPartnerActivityMode,
  setPartnerActivitySchedule,
  type ActivityScheduleSlot,
} from "@/lib/partner-register";
import { adminSetActivityMode, adminSetActivitySchedule } from "@/lib/admin-listing-edit";
import ActivityScheduleFields, {
  activityRowsFromSlots,
  activityRowsToSlots,
  activityRowsValid,
  newActivityRow,
  type ActivityRow,
  type ScheduleMode,
} from "@/app/partner/(dashboard)/business/activity-schedule-fields";
import { BackIcon } from "@/app/icons";

export default function ScheduleActivityForm({
  activityId,
  activityName,
  slots,
  initialMode,
  admin = false,
  backHref = "/partner/business",
}: {
  activityId: string;
  activityName: string;
  slots: ActivityScheduleSlot[];
  initialMode: ScheduleMode;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [rows, setRows] = useState<ActivityRow[]>(() => activityRowsFromSlots(slots, initialMode));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const canSubmit = activityRowsValid(rows) && !busy;

  const changeMode = (next: ScheduleMode) => {
    if (next === mode) return;
    setMode(next);
    setRows([newActivityRow(0, next)]);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);

    if (mode !== initialMode) {
      const modeResult = await (admin ? adminSetActivityMode : setPartnerActivityMode)(activityId, mode);
      if (!modeResult.ok) {
        setProblem(modeResult.message);
        setBusy(false);
        return;
      }
    }

    const result = await (admin ? adminSetActivitySchedule : setPartnerActivitySchedule)(
      activityId,
      activityRowsToSlots(rows),
    );

    if (!result.ok) {
      setProblem(result.message);
      setBusy(false);
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Hours — {activityName}</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Travellers see the next six days built from this, so saving takes effect right away — it
        doesn&apos;t need another review.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => changeMode("window")}
          className={`h-9 flex-1 rounded-xl text-[12.5px] font-bold ${
            mode === "window" ? "bg-brand text-white" : "border border-line bg-surface text-muted"
          }`}
        >
          A window, e.g. 9 AM–2 PM
        </button>
        <button
          type="button"
          onClick={() => changeMode("fixed")}
          className={`h-9 flex-1 rounded-xl text-[12.5px] font-bold ${
            mode === "fixed" ? "bg-brand text-white" : "border border-line bg-surface text-muted"
          }`}
        >
          Fixed departure times
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <ActivityScheduleFields rows={rows} onChange={setRows} mode={mode} />

        {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="mt-1 h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </>
  );
}
