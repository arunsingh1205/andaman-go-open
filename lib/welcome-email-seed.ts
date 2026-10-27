// One-time starting content for the "welcome" broadcast campaign
// (lib/admin-broadcasts.ts, 111) — the last version of the structured-field
// welcome template (2026-09-14), rendered to a static string so the design
// work (desktop width, light/dark mode) isn't lost when that editor is
// replaced by editing this campaign's raw HTML directly in Broadcasts.
// Used only once, the first time an admin sets up the welcome campaign —
// after that, whatever's saved on the campaign row is the source of truth,
// not this file.

export const WELCOME_EMAIL_SEED_SUBJECT = "Welcome to Andaman Go, {{partner_name}}";

export const WELCOME_EMAIL_SEED_HTML = `
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />

    <style>
      @media (prefers-color-scheme: dark) {
        .eaf-bg { background-color:#0E1A18 !important; }
        .eaf-surface { background-color:#173C3B !important; }
        .eaf-surface-text { color:#F2F6F5 !important; }
        .eaf-surface-muted { color:#AFC9C6 !important; }
        .eaf-badge-num { color:#7FD1C5 !important; }
        .eaf-heading { color:#F2F6F5 !important; }
        .eaf-muted { color:#8CA39F !important; }
        .eaf-logo-light { display:none !important; }
        .eaf-logo-dark { display:block !important; }
      }
    </style>
  </head>
  <body class="eaf-bg" style="margin:0;padding:0;background-color:#EEEEEC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="eaf-bg" style="background-color:#EEEEEC;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

          <tr><td style="padding:0 4px 18px;">
            <img src="https://andamango.in/brand/andaman-go-light-mode.png" alt="Andaman Go" height="22" class="eaf-logo-light" style="display:block;height:22px;width:auto;border:0;" />
            <img src="https://andamango.in/brand/andaman-go-dark-mode.png" alt="Andaman Go" height="22" class="eaf-logo-dark" style="display:none;height:22px;width:auto;border:0;" />
          </td></tr>

          <tr><td bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:18px 18px 0 0;padding:34px 32px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td valign="top">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td bgcolor="#13434C" style="border-radius:999px;padding:5px 12px;">
                    <span style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;font-weight:bold;letter-spacing:0.08em;color:#FFFFFF;text-transform:uppercase;">You&rsquo;re in</span>
                  </td>
                </tr></table>
                <p class="eaf-surface-text" style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.15;font-weight:bold;color:#13434C;">Welcome<br/>to the islands.</p>
                <p class="eaf-surface-muted" style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#54615D;max-width:370px;">
                  Your business is now part of Andaman Go, the booking app for island travel. Visitors can find you, book you and pay you in one place.
                </p>
              </td>
              <td width="18"></td>
              <td width="96" valign="top" align="right">
                <img src="https://andamango.in/brand/app-icon.png" alt="Andaman Go" width="96" height="96" style="display:block;border:0;border-radius:21px;" />
              </td>
            </tr></table>
          </td></tr>

          <tr><td bgcolor="#13434C" style="border-radius:0 0 18px 18px;padding:19px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#FFFFFF;max-width:320px;">
                  Ferries, rides, activities and tables across the Andaman Islands. In one app.
                </p>
              </td>
              <td width="12"></td>
              <td valign="middle" align="right">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td bgcolor="#FFFFFF" style="border-radius:999px;">
        <a href="https://andamango.in/partner/login" target="_blank"
           style="display:inline-block;padding:11px 20px;font-family:Arial,Helvetica,sans-serif;
                  font-size:13px;font-weight:bold;color:#13434C;text-decoration:none;white-space:nowrap;">
          Open the app &rarr;
        </a>
      </td>
    </tr></table></td>
            </tr></table>
          </td></tr>

          <tr><td style="height:38px;"></td></tr>

          <tr><td style="padding:0 4px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;color:#52A6A8;text-transform:uppercase;">What we are</p>
            <p class="eaf-heading" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#181F1E;">From the jetty to the last table on the beach.</p>
            <p class="eaf-muted" style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.65;color:#54615D;">
              Ferries, rides, activities and tables across the Andaman Islands. In one app. We bring local operators like you and visitors together in a single, trusted place, so a trip is planned in minutes and every booking is confirmed on the spot.
            </p>
          </td></tr>

          <tr><td style="height:28px;"></td></tr>

          <tr><td style="padding:0 4px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;color:#52A6A8;text-transform:uppercase;">What we offer</p>
            <p class="eaf-heading" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#181F1E;">Six things every island day needs.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>

    <td width="33%" valign="top" bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:12px;padding:16px 14px;">
      <p class="eaf-badge-num" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#52A6A8;">01</p>
      <p class="eaf-surface-text" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#181F1E;">Rental scooty</p>
      <p class="eaf-surface-muted" style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#54615D;">Book a ride, pick up in minutes.</p>
    </td>
    <td width="33%" valign="top" bgcolor="#13434C" style="border-radius:12px;padding:16px 14px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;">02</p>
      <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#FFFFFF;">Ferry</p>
      <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.8);">Seats, live schedule &amp; e-ticket.</p>
    </td>
    <td width="33%" valign="top" bgcolor="#52A6A8" style="border-radius:12px;padding:16px 14px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;">03</p>
      <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#FFFFFF;">Activities</p>
      <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.8);">Scuba, snorkelling, island tour.</p>
    </td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>

    <td width="33%" valign="top" bgcolor="#52A6A8" style="border-radius:12px;padding:16px 14px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;">04</p>
      <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#FFFFFF;">Events &amp; DJ</p>
      <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.8);">Passes for nights that match your vibe.</p>
    </td>
    <td width="33%" valign="top" bgcolor="#13434C" style="border-radius:12px;padding:16px 14px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#FFFFFF;">05</p>
      <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#FFFFFF;">Trips by locals</p>
      <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:rgba(255,255,255,0.8);">Itineraries planned by people who live here.</p>
    </td>
    <td width="33%" valign="top" bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:12px;padding:16px 14px;">
      <p class="eaf-badge-num" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#52A6A8;">06</p>
      <p class="eaf-surface-text" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#181F1E;">Reserve table</p>
      <p class="eaf-surface-muted" style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#54615D;">A seat at your favourite place, held for you.</p>
    </td>
      </tr></table>
          </td></tr>

          <tr><td style="height:8px;"></td></tr>

          <tr><td style="padding:0 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>
              <td width="50%" valign="top" bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:12px;padding:19px 18px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;color:#52A6A8;text-transform:uppercase;">Mission</p>
                <p class="eaf-surface-text" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;font-weight:bold;color:#181F1E;">Make every part of an island trip bookable in one place, with local operators paid fairly and on time.</p>
              </td>
              <td width="50%" valign="top" bgcolor="#13434C" style="border-radius:12px;padding:19px 18px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;color:#7FD1C5;text-transform:uppercase;">Vision</p>
                <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;font-weight:bold;color:#FFFFFF;">The single, trusted way to travel the Andaman Islands.</p>
              </td>
            </tr></table>
          </td></tr>

          <tr><td style="height:28px;"></td></tr>

          <tr><td style="padding:0 4px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;color:#52A6A8;text-transform:uppercase;">Next steps</p>
            <p class="eaf-heading" style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#181F1E;">Three steps before the tide turns.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin-top:8px;"><tr>

      <td width="33%" valign="top" bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:12px;padding:16px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="24" height="24" bgcolor="#13434C" align="center" valign="middle" style="border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#FFFFFF;">
            1
          </td>
        </tr></table>
        <p class="eaf-surface-text" style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;font-weight:bold;color:#181F1E;">Open the app and sign in with this email.</p>
      </td>
      <td width="33%" valign="top" bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:12px;padding:16px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="24" height="24" bgcolor="#13434C" align="center" valign="middle" style="border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#FFFFFF;">
            2
          </td>
        </tr></table>
        <p class="eaf-surface-text" style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;font-weight:bold;color:#181F1E;">Add your services, prices and availability.</p>
      </td>
      <td width="33%" valign="top" bgcolor="#E4F0EE" class="eaf-surface" style="border-radius:12px;padding:16px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="24" height="24" bgcolor="#13434C" align="center" valign="middle" style="border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#FFFFFF;">
            3
          </td>
        </tr></table>
        <p class="eaf-surface-text" style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;font-weight:bold;color:#181F1E;">Confirm payout details. Bookings start arriving.</p>
      </td>
            </tr></table>
          </td></tr>

          <tr><td style="height:32px;"></td></tr>

          <tr><td bgcolor="#13434C" style="border-radius:18px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="5" bgcolor="#52A6A8"></td></tr></table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="4" bgcolor="#7FD1C5"></td></tr></table>
            <div style="padding:28px 32px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.45;font-weight:bold;color:#FFFFFF;">
                Everything the trip needs, in one place. See you on the shore.
              </p>
              <div style="margin-top:16px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td bgcolor="#52A6A8" style="border-radius:999px;">
        <a href="https://andamango.in/partner/login" target="_blank"
           style="display:inline-block;padding:11px 20px;font-family:Arial,Helvetica,sans-serif;
                  font-size:13px;font-weight:bold;color:#FFFFFF;text-decoration:none;white-space:nowrap;">
          Open the app &rarr;
        </a>
      </td>
    </tr></table></div>
            </div>
          </td></tr>

          <tr><td style="height:20px;"></td></tr>

          <tr><td class="eaf-muted" style="padding:0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9A9F9C;">
            Questions? <a href="mailto:support@andamango.in" style="color:#9A9F9C;">support@andamango.in</a>
            &nbsp;&middot;&nbsp; Andaman Go, Port Blair, Andaman &amp; Nicobar Islands 744101
            &nbsp;&middot;&nbsp; <a href="mailto:support@andamango.in?subject=Unsubscribe" style="color:#9A9F9C;">Unsubscribe</a>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
