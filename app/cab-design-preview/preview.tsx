"use client";

import { useState, type FormEvent } from "react";
import styles from "./preview.module.css";

// Deliberately isolated fixtures: no live fares, booking calls or partner writes.
// Caps and inclusions are proposed for design review, not approved tariffs.
const SERVICES = [
  { id: "airport", island: "Port Blair", kind: "Transfer", title: "Airport → City hotel", detail: "One-way · city hotel zone", cap: 300, note: "30 minutes of pickup waiting included" },
  { id: "haddo", island: "Port Blair", kind: "Transfer", title: "Airport → Haddo jetty", detail: "One-way · ferry terminal drop", cap: 300, note: "30 minutes of pickup waiting included" },
  { id: "corbyn", island: "Port Blair", kind: "Sightseeing", title: "Corbyn’s Cove beach", detail: "Same-day return · 2-hour visit", cap: 800, note: "Hotel pickup and return; 2-hour visit included" },
  { id: "wandoor", island: "Port Blair", kind: "Sightseeing", title: "Wandoor Beach", detail: "Same-day return · 2-hour visit", cap: 1200, note: "Hotel pickup and return; 2-hour visit included" },
  { id: "day", island: "Port Blair", kind: "Day hire", title: "A day around Port Blair", detail: "10 hours · 200 km · one day", cap: 5500, note: "Extra use: ₹200/hour and ₹25/km, agreed before extending" },
  { id: "havelock", island: "Havelock", kind: "Transfer", title: "Havelock jetty → Hotel", detail: "One-way · selected nearby hotels", cap: 450, note: "30 minutes of pickup waiting included" },
  { id: "neil", island: "Neil Island", kind: "Transfer", title: "Neil jetty → Hotel", detail: "One-way · selected nearby hotels", cap: 450, note: "30 minutes of pickup waiting included" },
] as const;
type ServiceId = typeof SERVICES[number]["id"];
type Rates = Record<ServiceId, string>;
const INITIAL_RATES = Object.fromEntries(SERVICES.map(s => [s.id, String(s.cap)])) as Rates;
const ISLANDS = ["Port Blair", "Havelock", "Neil Island"];
const STEPS = ["Your vehicle", "Services", "Your prices", "Review"];
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
function validFare(value: string, cap: number) { return value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= cap; }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }

function CarDrawing() {
  return <svg viewBox="0 0 340 150" role="img" aria-label="Illustration of a white sedan" className={styles.car}>
    <ellipse cx="168" cy="125" rx="139" ry="9" fill="#123e4520" />
    <path d="M33 92 53 77 102 68 135 37Q144 29 163 29H214Q225 29 236 42L266 72 301 83Q310 87 310 99V111H29V102Z" fill="#fff" stroke="#93aaa9" strokeWidth="2" />
    <path d="m118 68 28-29h32v29Zm69-29h26q7 0 14 9l19 20h-59Z" fill="#6c9398" />
    <path d="M31 96h43m189-9 36 7M181 76v31m-84-31-9 32" stroke="#c5d6d5" strokeWidth="2" />
    <rect x="160" y="78" width="13" height="3" rx="1" fill="#77918f" /><rect x="231" y="78" width="13" height="3" rx="1" fill="#77918f" />
    <path d="M32 99h22l-4 8H31M289 90h17v8h-19" fill="#dfb36b" />
    {[88, 257].map(x => <g key={x}><circle cx={x} cy="111" r="23" fill="#203b40" /><circle cx={x} cy="111" r="13" fill="#c6d5d4" /><circle cx={x} cy="111" r="5" fill="#6b8387" /></g>)}
  </svg>;
}

export default function CabDesignPreview({ initialView }: { initialView: "traveller" | "partner" }) {
  const [view, setView] = useState(initialView);
  const [step, setStep] = useState(0);
  const [island, setIsland] = useState("Port Blair");
  const [kind, setKind] = useState("Transfer");
  const [serviceId, setServiceId] = useState<ServiceId>("airport");
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("09:00");
  const [budget, setBudget] = useState("");
  const [passengers, setPassengers] = useState("2");
  const [hotel, setHotel] = useState("City hotel (within the included zone)");
  const [checkout, setCheckout] = useState(false);
  const [payment, setPayment] = useState("driver");
  const [confirmed, setConfirmed] = useState(false);
  const [partnerIsland, setPartnerIsland] = useState("Port Blair");
  const [model, setModel] = useState("Toyota Etios");
  const [registration, setRegistration] = useState("AN-01-T-1234");
  const [bags, setBags] = useState("2");
  const [selected, setSelected] = useState<ServiceId[]>(["airport", "haddo", "corbyn"]);
  const [rates, setRates] = useState<Rates>({ ...INITIAL_RATES });
  const [publishedRates, setPublishedRates] = useState<Rates>({ ...INITIAL_RATES });
  const [offered, setOffered] = useState<ServiceId[]>(SERVICES.map(s => s.id));
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const service = SERVICES.find(s => s.id === serviceId)!;
  const fare = Number(publishedRates[serviceId]);
  const options = SERVICES.filter(s => s.island === island && s.kind === kind);
  const night = time < "06:00" || time >= "22:00";
  const custom = service.kind !== "Day hire" && hotel === "Other hotel / outside included zone";
  const overBudget = budget !== "" && fare > Number(budget);
  const unavailable = !offered.includes(serviceId) || Number(passengers) > 4;
  const ready = !night && !custom && !overBudget && !unavailable;
  const chosen = SERVICES.filter(s => selected.includes(s.id));
  const allValid = chosen.length > 0 && chosen.every(s => validFare(rates[s.id], s.cap));

  function changeTrip(nextIsland: string, nextKind: string) {
    const available = SERVICES.filter(s => s.island === nextIsland);
    const next = available.find(s => s.kind === nextKind) ?? available[0];
    setIsland(nextIsland); setKind(next.kind); setServiceId(next.id); setCheckout(false); setConfirmed(false);
  }
  function nextStep(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setNotice("");
    if (step === 1 && !selected.length) return;
    if (step === 2 && !allValid) return;
    if (step < 3) { setStep(step + 1); return; }
    if (!accepted || !allValid) return;
    setPublishedRates({ ...rates });
    setOffered(prev => [...prev.filter(id => SERVICES.find(s => s.id === id)!.island !== partnerIsland), ...selected]);
    setSubmitted(true);
  }

  return <main className={styles.preview}>
    <div className={styles.reviewBar}><span><strong>DESIGN PREVIEW</strong><span className={styles.barNote}> Proposed fares · no live bookings or changes</span></span><div className={styles.viewSwitch} aria-label="Preview view"><button type="button" aria-pressed={view === "traveller"} onClick={() => setView("traveller")}>Traveller view</button><button type="button" aria-pressed={view === "partner"} onClick={() => setView("partner")}>Partner view</button></div></div>
    <header className={styles.header}><div className={styles.wordmark}>andaman<span>go</span><i>●</i></div><span className={styles.headerLabel}>{view === "traveller" ? "ISLAND RIDES, MADE SIMPLE" : "PARTNER WORKSPACE"}</span><div className={styles.avatar}>{view === "traveller" ? "AG" : "AP"}</div></header>

    {view === "traveller" ? <div className={styles.container}>
      <section className={styles.hero}><div><span className={styles.eyebrow}>YOUR ISLAND. YOUR PACE.</span><h1>A local ride.<br />A price you know.</h1><p>From the first airport hello to the last beach sunset.<br className={styles.desktopOnly} /> Find the right cab, with your fare agreed upfront.</p><div className={styles.heroTags}><span>✓ Private AC cabs</span><span>✓ Clear inclusions</span><span>✓ Local partners</span></div></div><div className={styles.heroArt}><div className={styles.sun} /><div className={styles.routeLine} /><span className={styles.mapPin}>● &nbsp; Airport</span><CarDrawing /><span className={styles.destination}>Your next island memory ↗</span></div></section>
      <div className={styles.travellerGrid}>
        <section className={styles.panel} aria-label="Plan your ride"><div className={styles.sectionTitle}><span className={styles.number}>01</span><h2>Where are we taking you?</h2></div>
          <div className={styles.pills}>{ISLANDS.map(i => <button type="button" key={i} aria-pressed={island === i} onClick={() => changeTrip(i, kind)}>{i}</button>)}</div>
          <div className={styles.tripTypes}>{["Transfer", "Sightseeing", "Day hire"].map(k => <button type="button" key={k} disabled={!SERVICES.some(s => s.island === island && s.kind === k)} aria-pressed={kind === k} onClick={() => changeTrip(island, k)}>{k}</button>)}</div>
          <label className={styles.field}>Your trip<select value={serviceId} onChange={e => { setServiceId(e.target.value as ServiceId); setCheckout(false); setConfirmed(false); }}>{options.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
          {service.kind !== "Day hire" && <label className={styles.field}>Hotel / pickup zone<select value={hotel} onChange={e => { setHotel(e.target.value); setCheckout(false); setConfirmed(false); }}><option>City hotel (within the included zone)</option><option>Other hotel / outside included zone</option></select></label>}
          <div className={styles.twoCols}><label className={styles.field}>Travel date<input type="date" min={tomorrow()} value={date} onChange={e => { setDate(e.target.value); setCheckout(false); setConfirmed(false); }} /></label><label className={styles.field}>Pickup time<input type="time" value={time} onChange={e => { setTime(e.target.value); setCheckout(false); setConfirmed(false); }} /></label></div>
          <div className={styles.twoCols}><label className={styles.field}>Travellers<select value={passengers} onChange={e => { setPassengers(e.target.value); setCheckout(false); setConfirmed(false); }}>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? "person" : "people"}</option>)}</select></label><label className={styles.field}>Your budget <small>optional</small><input type="number" min="0" placeholder="Maximum ₹ per trip" value={budget} onChange={e => { setBudget(e.target.value); setCheckout(false); setConfirmed(false); }} /></label></div>
          <div className={styles.softNote}>↗ {service.kind === "Sightseeing" ? "Same-day return included. Overnight trips need a custom quote." : service.kind === "Day hire" ? "One day, up to 10 hours and 200 km. Extra use needs your agreement." : "One-way private transfer. Your cab fare is per vehicle, not per person."}</div>
        </section>
        <section aria-live="polite" className={styles.results}>
          <div className={styles.resultsTitle}><div><span className={styles.eyebrow}>YOUR RIDE</span><h2>{checkout ? "Review your trip" : "Less planning. More exploring."}</h2></div><span className={styles.sampleBadge}>Sample partner</span></div>
          {!ready ? <div className={styles.panel}><span className={styles.largeIcon}>↗</span><h2>{overBudget ? "No rides within this budget" : unavailable ? "No matching car in this preview" : "Let’s tailor this trip"}</h2><p className={styles.muted}>{overBudget ? `This sample ride is ${money(fare)}. Increase your budget or choose another trip.` : unavailable ? "Try up to four passengers or enable this route in the partner preview." : "This time or hotel is outside the sample rate card. A partner would confirm the full fare before you book."}</p><p className={styles.softNote}>No estimated amount is presented as a confirmed fare.</p></div> : <article className={styles.rideCard}>
            <div className={styles.rideTop}><div><span className={styles.greenBadge}>PRIVATE AC SEDAN</span><h3>{model || "Toyota Etios"}</h3><p>4 passengers <span>·</span> {bags} bags <span>·</span> Local driver</p></div><div className={styles.miniCar}><CarDrawing /></div></div>
            <div className={styles.routeSummary}><span className={styles.number}>↗</span><div><strong>{service.title}</strong><p>{service.detail}</p></div></div>
            <div className={styles.inclusions}><span>✓ Fuel & driver</span><span>✓ Ordinary parking</span><span>✓ {service.kind === "Transfer" ? "Pickup waiting" : "Agreed itinerary"}</span></div>
            <details className={styles.details}><summary>What’s included & trip terms</summary><p>{service.note}. Entry and ferry tickets are not included. Additional stops or extra use need an agreed new price. Example cancellation terms: free until 24 hours before pickup; later cancellation 50%; no-show 100%. These are proposed terms for review.</p></details>
            {checkout && <div className={styles.checkout}><p><strong>{date} · {time} IST</strong><br />{passengers} travellers · {island}</p><label className={styles.radio}><input type="radio" name="payment" checked={payment === "driver"} onChange={() => setPayment("driver")} />Pay the driver after your ride</label><label className={styles.radio}><input type="radio" name="payment" checked={payment === "online"} onChange={() => setPayment("online")} />Pay the full fare online</label><div className={styles.paymentLines}><span>Pay now <strong>{money(payment === "online" ? fare : 0)}</strong></span><span>Pay driver <strong>{money(payment === "driver" ? fare : 0)}</strong></span></div></div>}
            <div className={styles.fareFooter}><div><span className={styles.muted}>Total for this trip</span><strong className={styles.price}>{money(fare)}</strong><small>Includes all mandatory cab charges</small></div><button type="button" className={styles.primary} disabled={!date || date < tomorrow() || !time} onClick={() => { if (checkout) setConfirmed(true); else setCheckout(true); }}>{checkout ? "Try confirmation" : "Review this ride"} <span>→</span></button></div>
            {confirmed && <div role="status" className={styles.success}>✓ Preview complete. Your example total is {money(fare)}. No booking or payment was made.</div>}
          </article>}
          <div className={styles.promise}><span>◎</span><div><strong>Your fare stays yours.</strong><p>For the agreed trip, the driver sees the same total you do. Any change needs your approval first.</p></div></div>
        </section>
      </div>
    </div> : <div className={styles.container}>
      <div className={styles.partnerHeading}><div><span className={styles.eyebrow}>GROW WITH ANDAMAN GO</span><h1>Your car. Your routes.<br /><em>Your next booking.</em></h1><p>A little setup now. Clear fares for every ride.</p></div><div className={styles.partnerStamp}><span>₹</span><strong>You set your fare</strong><small>Within the proposed route limit</small></div></div>
      <ol className={styles.stepper}>{STEPS.map((s,i) => <li key={s} aria-current={step === i ? "step" : undefined}><span>{step > i ? "✓" : i+1}</span><strong>{s}</strong></li>)}</ol>
      {submitted ? <section className={`${styles.panel} ${styles.finished}`}><span className={styles.largeIcon}>✓</span><h2>Your preview rate card is ready</h2><p>{chosen.length} services updated in this browser preview. Nothing was submitted to the live system.</p><button type="button" className={styles.primary} onClick={() => { changeTrip(partnerIsland, "Transfer"); setView("traveller"); }}>See the traveller view →</button><button type="button" className={styles.textButton} onClick={() => { setSubmitted(false); setStep(2); }}>Keep editing</button></section> : <form onSubmit={nextStep} className={styles.partnerGrid}>
        <section className={styles.panel}>
          <div className={styles.sectionTitle}><span className={styles.number}>0{step+1}</span><div><h2>{["Let’s meet your car", "Choose the rides you offer", "A fair price, set by you", "Ready for the road"][step]}</h2><p>{["Start with the details travellers care about.", "Only offer the trips that work for your business.", "Your price is the full amount the traveller pays.", "Check your vehicle, fares and the promise you’re making."][step]}</p></div></div>
          {step === 0 && <>
            <label className={styles.field}>Where is your car based?<select value={partnerIsland} onChange={e => { setPartnerIsland(e.target.value); setSelected(SERVICES.filter(s => s.island === e.target.value).map(s => s.id)); setAccepted(false); }}>{ISLANDS.map(i => <option key={i}>{i}</option>)}</select></label>
            <div className={styles.twoCols}><label className={styles.field}>Car model<input required maxLength={60} value={model} onChange={e => setModel(e.target.value)} /></label><label className={styles.field}>Vehicle category<input readOnly value="Standard AC sedan" /><small>Other vehicle classes need separate rate cards.</small></label></div>
            <div className={styles.twoCols}><label className={styles.field}>Passenger seats<input readOnly value="4 (excluding driver)" /></label><label className={styles.field}>Luggage bags<select value={bags} onChange={e => setBags(e.target.value)}>{[1,2,3].map(n => <option key={n}>{n}</option>)}</select></label></div>
            <label className={styles.field}>Commercial registration number<input required pattern="[A-Za-z0-9 -]{6,20}" maxLength={20} value={registration} onChange={e => setRegistration(e.target.value.toUpperCase())} /><small>Example: AN-01-T-1234</small></label>
            <label className={styles.upload}><span>＋</span><strong>Add car photos</strong><small>Exterior and interior · optional for this preview</small><input type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files ?? []).map(f => f.name))} /></label>{photos.length > 0 && <p className={styles.softNote}>{photos.length} photos selected: {photos.join(", ")}. Files stay on your device.</p>}
            <details className={styles.details}><summary>Optional vehicle details</summary><label className={styles.field}>Fuel<select defaultValue="Petrol"><option>Petrol</option><option>Diesel</option><option>Electric</option></select></label><label className={styles.field}>Anything travellers should know?<input placeholder="For example, child seat available on request" /></label></details>
          </>}
          {step === 1 && <><div className={styles.softNote}>◎ {partnerIsland} · Standard AC sedan · select one or more services</div>{SERVICES.filter(s => s.island === partnerIsland).map(s => <label key={s.id} className={`${styles.serviceChoice} ${selected.includes(s.id) ? styles.selectedChoice : ""}`}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => { setSelected(e.target.checked ? [...selected,s.id] : selected.filter(id => id !== s.id)); setAccepted(false); }} /><div><strong>{s.title}</strong><small>{s.detail}</small></div><span>{money(s.cap)}<small>proposed limit</small></span></label>)}{!selected.length && <p role="status" className={styles.error}>Choose at least one service to continue.</p>}</>}
          {step === 2 && <><div className={styles.priceIntro}>✓ Include fuel, driver, ordinary parking and all mandatory cab charges.</div>{chosen.map(s => <div key={s.id} className={styles.rateCard}><div className={styles.rateHeading}><div><h3>{s.title}</h3><p>{s.detail}</p></div><span className={styles.sampleBadge}>{s.kind}</span></div><div className={styles.rateInputs}><div><small>Proposed maximum</small><strong>{money(s.cap)}</strong></div><label className={styles.field}>Your total fare (₹)<input aria-label={`Fare for ${s.title}`} aria-invalid={!validFare(rates[s.id], s.cap)} aria-describedby={`fare-help-${s.id}`} type="number" required min="1" max={s.cap} step="1" value={rates[s.id]} onChange={e => { setRates({ ...rates, [s.id]:e.target.value }); setAccepted(false); }} /></label></div><p id={`fare-help-${s.id}`} className={validFare(rates[s.id], s.cap) ? styles.fareGood : styles.error}>{validFare(rates[s.id], s.cap) ? `✓ Traveller pays ${money(Number(rates[s.id]))} · within proposed limit` : `Enter a whole-rupee fare from ₹1 to ${money(s.cap)}. Lower your fare or remove this service.`}</p><small className={styles.muted}>{s.note}</small></div>)}<details className={styles.details}><summary>How were these suggested prices chosen?</summary><p>Based on published fares reviewed on 8 September 2026. These are illustrative maximums, subject to matching vehicle class, hotel zones and partner acceptance. Waiting allowances are proposed for this design.</p><a href="https://www.andamanocean.in/andaman-cab-services/" target="_blank" rel="noreferrer">Andaman Ocean fare list ↗</a><br /><a href="https://andamancabsbooking.com/" target="_blank" rel="noreferrer">Andaman Cabs Booking fare list ↗</a></details></>}
          {step === 3 && <><div className={styles.reviewVehicle}><CarDrawing /><div><h3>{model}</h3><p>{registration} · {partnerIsland}</p><p>AC sedan · 4 passengers · {bags} bags</p></div></div>{chosen.map(s => <div key={s.id} className={styles.reviewRow}><span><strong>{s.title}</strong><small>{s.detail}</small></span><strong>{money(Number(rates[s.id]))}</strong></div>)}<div className={styles.softNote}>Fuel, driver and ordinary parking are included. Entry/ferry tickets are separate. Extra use requires an agreed price. Proposed cancellation: free until 24 hours before pickup; later 50%; no-show 100%.</div><label className={styles.agreement}><input type="checkbox" required checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I agree to honour these fares and inclusions. I will get the traveller’s approval before providing a paid extra.</span></label></>}
          <div className={styles.formFooter}><button type="button" className={styles.textButton} onClick={() => step > 0 ? setStep(step-1) : setNotice("Draft kept for this preview session. Nothing has been uploaded.")}>{step > 0 ? "← Back" : "Save draft"}</button><span>{step+1} of 4</span><button type="submit" className={styles.primary} disabled={(step === 1 && !selected.length) || (step >= 2 && !allValid) || (step === 3 && !accepted)}>{step === 3 ? "Finish preview" : "Continue"} →</button></div>{notice && <p role="status" className={styles.softNote}>{notice}</p>}
        </section>
        <aside className={styles.partnerAside}><div className={styles.previewLabel}>WHAT TRAVELLERS WILL SEE</div><div className={styles.miniListing}><CarDrawing /><h3>{model || "Your car model"}</h3><p>{partnerIsland} · AC sedan · 4 seats</p><div className={styles.miniDivider} />{chosen.slice(0,3).map(s => <div className={styles.miniRate} key={s.id}><span>{s.title}</span><strong>{validFare(rates[s.id],s.cap) ? money(Number(rates[s.id])) : "Set fare"}</strong></div>)}{chosen.length > 3 && <small>+ {chosen.length-3} more services</small>}<div className={styles.softNote}>✓ Clear fares. No surprise cab charges.</div></div><div className={styles.asideTip}><span>↗</span><h3>Start with your best routes.</h3><p>You can choose fewer services, price below the maximum or pause a route. Each fare is your commitment to the traveller.</p></div></aside>
      </form>}
    </div>}
    <footer className={styles.bottom}>ANDAMAN GO <span>Made for island journeys.</span><small>Interactive design proposal · prices and terms await approval</small></footer>
  </main>;
}
