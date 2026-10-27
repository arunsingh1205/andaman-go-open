import Link from "next/link";
import { BackIcon } from "@/app/icons";

// The one back-navigation element every page-with-a-back-button renders
// through, so the native iOS 26 Liquid Glass back button (added natively,
// not here — see ios-app/App/App/AppRootViewController.swift) has exactly
// one thing to hide instead of fifteen-plus hand-rolled ones. Every render
// carries data-page-back regardless of variant or tone; app/globals.css
// hides anything with that attribute once :root[data-native-chrome] is set.
//
// Deliberately just the back element, not a full page-header component: the
// surrounding header markup differs too much per page (container width,
// background tone, auxiliary content) to templatize without either an
// explosion of props or an unwanted visual reskin. This solves the actual
// problem — one marker, everywhere — without touching anything else.

type Props = {
  href: string;
  /** "icon": the bordered-header shape most list pages use. "text": the
   *  "← All X" breadcrumb detail pages float over a hero photo. */
  variant?: "icon" | "text";
  /** icon: the aria-label (default "Back"). text: the required label text. */
  label?: string;
  size?: number;
  className?: string;
};

export default function PageBack({ href, variant = "icon", label, size = 21, className }: Props) {
  if (variant === "text") {
    return (
      <Link
        href={href}
        data-page-back
        className={`-ml-2 flex h-11 w-fit items-center px-2 text-[13px] font-semibold text-muted ${className ?? ""}`}
      >
        ← {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label ?? "Back"}
      data-page-back
      className={`-ml-2.5 flex h-11 w-11 items-center justify-center ${className ?? ""}`}
    >
      <BackIcon size={size} />
    </Link>
  );
}
