// ==========================================================
// AKINF2P — VIP PAGE
// Loads the current membership plan (name/price/features) from
// the database so changes the owner makes in owner.html actually
// show up here — the HTML has hardcoded fallback content in case
// this fetch fails, so the page never looks broken either way.
// ==========================================================

async function loadMembershipPlan() {
  const { data: plan, error } = await supabaseClient
    .from("membership_plan")
    .select("name, price, features")
    .eq("id", 1)
    .single();

  if (error || !plan) return; // fallback HTML stays as-is

  const nameEl = document.getElementById("planName");
  const priceEl = document.getElementById("planPrice");
  const featuresEl = document.getElementById("planFeatures");

  if (nameEl) nameEl.textContent = "⭐ " + plan.name;

  if (priceEl) {
    priceEl.innerHTML = `R${Number(plan.price).toFixed(2)} <span>/ Month</span>`;
  }

  if (featuresEl && Array.isArray(plan.features)) {
    featuresEl.innerHTML = plan.features.map((f) => `<li>✅ ${f}</li>`).join("");
  }
}

loadMembershipPlan();
