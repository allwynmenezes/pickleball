/* ===================== The Pickle Slot — OTP mailer =====================
   Deploy this as a Google Apps Script Web App to send login/signup OTP
   codes on the backend's behalf.

   Setup:
     1. Go to https://script.google.com/ → New project.
     2. Delete the boilerplate and paste this whole file in.
     3. Project Settings → Script Properties → add a property named
        SHARED_SECRET with a long random value (this is what the backend
        must send to prove the request is really from it, since Apps
        Script web apps don't support custom auth headers).
     4. Deploy → New deployment → type "Web app".
          Execute as: Me
          Who has access: Anyone
     5. Copy the deployed /exec URL. Put it, and the same secret from step
        3, into backend/.env as APPS_SCRIPT_URL and APPS_SCRIPT_SECRET.
     6. Re-deploy (Deploy → Manage deployments → edit → new version)
        whenever you change this file — editing the script alone does not
        update a live deployment. */

function doPost(e) {
  var reply = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'Malformed request body.' });
  }

  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected || body.secret !== expected) {
    return reply({ ok: false, error: 'Unauthorized.' });
  }

  var email = body.email;
  var otp = body.otp;
  if (!email || !otp) {
    return reply({ ok: false, error: 'Missing email or otp.' });
  }

  MailApp.sendEmail({
    to: email,
    subject: 'Your The Pickle Slot code: ' + otp,
    body:
      'Your verification code is: ' + otp + '\n\n' +
      'It expires in 10 minutes. If you did not request this, you can ignore this email.',
  });

  return reply({ ok: true });
}
