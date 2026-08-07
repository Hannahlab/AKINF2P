export async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_ADDRESS"); // e.g. "AKINF2P <memberships@yourdomain.com>"

  if (!apiKey || !from) {
    console.warn("Resend not configured (RESEND_API_KEY / RESEND_FROM_ADDRESS missing) — skipping email:", subject);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    console.error("Resend error:", await res.text());
  }
}

export function emailWrapper(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; background:#090500; padding:32px; color:#ddd;">
      <div style="max-width:480px; margin:0 auto; background:#0f0902; border:1px solid rgba(224,179,81,0.25); border-radius:16px; padding:32px;">
        <h1 style="color:#e0b351; font-size:20px; margin-bottom:16px;">${title}</h1>
        ${bodyHtml}
        <p style="color:#777; font-size:12px; margin-top:24px;">— The AKINF2P Team</p>
      </div>
    </div>
  `;
}
