"use client";

// A camera-based alternative to typing a code by hand — for the partner
// standing at the jetty or the dive-shop counter with a phone in one hand
// and a queue in front of them.
//
// Used to run on the browser's own BarcodeDetector API instead of a JS
// decoder, on the theory that "Chrome/Edge/most Android browsers, and
// recent Safari" covered enough devices. It doesn't cover the one that
// matters most here: WKWebView (the wrapped native iOS app this partner
// dashboard actually ships as) has never implemented BarcodeDetector, same
// as Safari — so on iOS the scanner always fell straight to "Scanning
// isn't supported here," which is what "the scanner is not working" meant
// in practice. jsQR decodes a plain canvas ImageData buffer instead of
// relying on any browser API, so it works identically everywhere
// getUserMedia + <canvas> do (which is everywhere this app already runs) —
// and since decoding happens entirely on-device with no network call, it
// was already "offline" the moment it stopped depending on a browser API
// that iOS doesn't ship.
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { CameraIcon, CloseIcon } from "@/app/icons";

export default function QrScanner({
  onDetected,
  onClose,
}: {
  onDetected: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "denied">("starting");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let frame = 0;

    const tick = () => {
      if (stopped || !videoRef.current) return;
      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // A fresh, appropriately-sized canvas per frame is wasteful — one
        // reused offscreen canvas, resized only when the video's own
        // dimensions change (i.e. once, right after the stream starts).
        if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
        const canvas = canvasRef.current;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(frameData.data, frameData.width, frameData.height);
          if (code?.data) {
            onDetected(code.data);
            return; // parent unmounts this on a hit — no need to keep scanning
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setStatus("scanning");
        frame = requestAnimationFrame(tick);
      })
      .catch(() => setStatus("denied"));

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // onDetected is a stable-enough callback in practice (identity churn here
    // would just restart the camera stream, not cause a correctness bug).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[13px] font-bold text-white">Scan the ticket QR</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {status !== "denied" && (
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        )}

        {status === "scanning" && (
          <div className="pointer-events-none absolute h-56 w-56 rounded-2xl border-2 border-white/80" />
        )}

        {status === "starting" && (
          <p className="absolute text-[13px] font-semibold text-white/80">Starting camera…</p>
        )}

        {status === "denied" && (
          <div className="mx-6 max-w-xs text-center">
            <p className="text-[14px] font-bold text-white">Camera access denied</p>
            <p className="mt-1.5 text-[12.5px] font-medium text-white/70">
              Allow camera access for this site, or close this and type the code instead.
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mx-4 mb-6 flex h-12 items-center justify-center gap-2 rounded-xl bg-white/15 text-[13.5px] font-bold text-white"
      >
        <CameraIcon size={16} />
        Type the code instead
      </button>
    </div>
  );
}
