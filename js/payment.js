// ==========================================================
// AKINF2P — MEMBERSHIP CHECKOUT
// Starts a Paystack checkout for the R59.99 Akinf2p Pro plan
// via a Supabase Edge Function. Actual activation only ever
// happens server-side once Paystack confirms payment (see
// supabase/functions/paystack-webhook) — never trusted client-side.
// ==========================================================

async function startProCheckout() {
  const errorEl = document.getElementById("joinProError");
  if (errorEl) errorEl.textContent = "";

  const user = await getCurrentUser();

  if (!user) {
    const accountModal = document.getElementById("accountModal");
    if (accountModal) accountModal.style.display = "flex";
    if (errorEl) errorEl.textContent = "Please log in or sign up first, then click Join again.";
    return;
  }

  if (errorEl) errorEl.textContent = "Redirecting to secure checkout…";

  try {
    const token = await getSessionToken();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: user.email, user_id: user.id }),
    });

    const result = await res.json();

    if (!res.ok || !result.authorization_url) {
      if (errorEl) errorEl.textContent = "Could not start checkout. Please try again.";
      return;
    }

    window.location.href = result.authorization_url;
  } catch (err) {
    if (errorEl) errorEl.textContent = "Something went wrong. Please try again.";
  }
}

["joinProBtn", "joinProBtnSecondary"].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener("click", startProCheckout);
});
