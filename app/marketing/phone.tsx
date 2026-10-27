// The phone every app screen on the marketing page sits in — a real 3D object
// rather than a flat frame.
//
// Three nested boxes, each with one job, so their transforms never fight:
//
//   rig    holds the size and the camera (perspective), and is the thing a
//          section positions;
//   sway   drifts on its own, slowly, so the phone is never quite still;
//   phone  takes the scroll-driven turn each section gives it.
//
// The thickness is a stack of copies of the body pushed back along Z, which
// is what lets the side of the phone show when it turns.

import s from "../home.module.css";

const EDGE_LAYERS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function Phone({
  className = "",
  swayClassName = "",
  children,
}: {
  className?: string;
  swayClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${s.rig} ${className}`}>
      <span className={s.rigShadow} aria-hidden />
      <div className={`${s.sway} ${swayClassName}`}>
        <div className={s.phone}>
          {EDGE_LAYERS.map((k) => (
            <span
              key={k}
              className={s.phoneEdge}
              style={{ "--k": k } as React.CSSProperties}
              aria-hidden
            />
          ))}
          <div className={s.phoneScreen}>{children}</div>
          <span className={s.phoneGlare} aria-hidden />
        </div>
      </div>
    </div>
  );
}
