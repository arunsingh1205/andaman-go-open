// Phone-number display. Plain data — no directive — so both server components
// and client components can format the same way.

/** +919876543210 → +91 98765 43210 */
export function prettyPhone(phone: string): string {
  const indian = phone.match(/^\+91(\d{5})(\d{5})$/);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}
