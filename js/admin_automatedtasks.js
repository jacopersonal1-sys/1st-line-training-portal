/* ================= ADMIN: AUTOMATED TASKS ================= */
/* Handles automated tasks like email generation, etc. */

function generateOnboardingEmail(emails) {
    if (!emails || emails.length === 0) return;

    const toAddress = "systemsupport@herotel.com";
    const ccAddresses = "darren.tupper@herotel.com,jaco.prince@herotel.com,soanette.wilken@herotel.com";
    const subject = "Access Request for New Onboards";
    
    // Construct the body with the specific template requested
    const body = `Good day.

Hope this finds you well.

Kindly assist with access to the following programs (the error the onboards are getting is either their email address is not found or incorrect username & password):

Q-Contact
Corteza (CRM Instance present)
ACS
Odoo portal

Please find the onboards whom require access below:
${emails.join('\n')}`;

    // Create mailto link
    // encodeURIComponent ensures special characters (newlines, spaces) are handled correctly
    const mailtoLink = `mailto:${toAddress}?cc=${ccAddresses}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    // Open default mail client (Outlook)
    // We use window.location.href for mailto links as it's the standard way to trigger the client
    window.location.href = mailtoLink;
}
