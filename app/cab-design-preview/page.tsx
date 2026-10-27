import type { Metadata } from "next";
import CabDesignPreview from "./preview";

export const metadata: Metadata = {
  title: "Cab experience preview | Andaman Go",
  robots: { index: false, follow: false },
};

export default async function CabPreviewPage({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  return <CabDesignPreview initialView={view === "partner" ? "partner" : "traveller"} />;
}
