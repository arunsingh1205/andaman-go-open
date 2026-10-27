"use client";

import { useIsland } from "@/lib/island-context";

export function IslandName() {
  const { island } = useIsland();
  return <>{island.name}</>;
}

export default function SelectedIsland({ suffix }: { suffix: string }) {
  const { island } = useIsland();
  return (
    <>
      {island.name} · {suffix}
    </>
  );
}
