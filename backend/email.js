/* ===================== EMAIL =====================
   Sends OTP emails by POSTing to a Google Apps Script web app deployment
   (see email/apps-script.gs for the script to paste in) — no third-party
   email provider or account needed beyond the Google account that deploys
   it. Configure via env vars (see .env.example):
     APPS_SCRIPT_URL    the deployed web app's /exec URL
     APPS_SCRIPT_SECRET shared secret the script checks before sending,
                         so the endpoint can be public without being an
                         open relay */
async function sendOtpEmail(email, otp) {
  // Read at send time: .env is only loaded when the server is started for
  // real (see server.js), never when tests require these modules.
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
  const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    // Dev fallback so the flow is testable before the Apps Script is deployed.
    console.log(`[email:dev-stub] OTP for ${email}: ${otp}`);
    return;
  }
  const startedAt = Date.now();
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: APPS_SCRIPT_SECRET, email, otp }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Apps Script responded with ${res.status}`);
  /* Only an explicit { ok: true } counts as sent. When the script itself
     crashes (e.g. MailApp not authorised, quota hit), Google answers 200
     with an HTML error page — treating that as success would tell the user
     a code is on its way when nothing was sent. */
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* not JSON: an Apps Script error page */ }
  if (!body || body.ok !== true) {
    throw new Error((body && body.error) || 'Apps Script did not confirm the email was sent (it returned a non-JSON error page).');
  }
  console.log(`[email] code sent to ${email} in ${Date.now() - startedAt}ms`);
}

module.exports = { sendOtpEmail };
