// Matches the booking confirmation screen: success icon, heading, the
// ticket card and its QR block, while the booking details and QR resolve.

const bar = "block rounded bg-line";

export default function Loading() {
  return (
    <main className="page-flow flex animate-pulse flex-col items-center pt-14 pb-16">
      <span className="h-16 w-16 rounded-full bg-line" />

      <span className={`${bar} mt-4 h-5 w-56`} />
      <span className={`${bar} mt-2 h-3 w-64`} />

      <div className="mt-6 w-full overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <span className="h-11 w-11 shrink-0 rounded-[13px] bg-line" />
            <div className="min-w-0 flex-1">
              <span className={`${bar} h-4 w-3/4`} />
              <span className={`${bar} mt-2 h-3 w-1/2`} />
              <span className={`${bar} mt-2 h-3 w-2/3`} />
            </div>
          </div>
          <div className="mt-3.5 flex flex-col gap-2 border-t border-hairline pt-3">
            <span className={`${bar} h-3.5 w-full`} />
            <span className={`${bar} h-3.5 w-full`} />
          </div>
        </div>

        <div className="border-t border-dashed border-line bg-ground px-4 pt-5 pb-4 text-center">
          <span className="mx-auto block h-[116px] w-[116px] rounded-[14px] bg-line" />
          <span className={`${bar} mx-auto mt-3 h-4 w-32`} />
        </div>
      </div>

      <div className="mt-8 flex w-full flex-col gap-2.5">
        <span className="block h-13 w-full rounded-2xl bg-line" />
        <span className="block h-12 w-full rounded-2xl bg-line" />
      </div>
    </main>
  );
}
