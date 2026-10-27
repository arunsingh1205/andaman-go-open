import LoadingSkeleton from "./loading-skeleton";

// Colocated with layout.tsx, so this one file is the Suspense boundary
// Next.js shows for every route under the admin dashboard during its
// initial data fetch — no per-route file needed unless a specific screen
// later wants its own closer-matching shape.
export default function Loading() {
  return <LoadingSkeleton />;
}
