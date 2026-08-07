// ==========================================================
// AKINF2P — INVESTMENTS PAGE
// Renders the weekly picks from the `investments` table using
// the exact same card markup/classes as the original static design.
// ==========================================================

function escapeHTMLLocal(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

const FALLBACK_IMAGE =
  "https://res.cloudinary.com/kfcu2z4r/image/upload/v1784216475/file_00000000eed471f491495382e79eea06_otmtrn.png";

function statusBadge(status) {
  if (status === "active") return "✅ Available Now";
  if (status === "sold") return "🔒 Sold Out";
  return "⏳ Coming Soon";
}

function investmentCardHTML(inv) {
  const imgSrc = inv.image_url || FALLBACK_IMAGE;
  const dimOriginal = !inv.image_url ? ' style="opacity:0.35;"' : "";
  const likeDisabled = inv.status === "active" ? "" : "disabled";

  return `
<div class="investment-card">

    <div class="player-image">
        <img
          src="${imgSrc}"
          alt="Player"${dimOriginal}
          onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';this.style.opacity=0.35;"
        >
    </div>

    <div class="player-details">
        <h3>${escapeHTMLLocal(inv.title)}</h3>
        <p>${escapeHTMLLocal(inv.description || "")}</p>
        <span class="buy-status">${statusBadge(inv.status)}</span>
        <button class="like-btn" ${likeDisabled}></button>
    </div>

</div>`;
}

async function loadInvestments() {
  const grid = document.getElementById("investmentGrid");
  if (!grid) return;

  const { data, error } = await supabaseClient
    .from("investments")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error || !data || data.length === 0) {
    grid.innerHTML = `<div class="investment-card"><div class="player-details"><p>No investment picks yet — check back soon.</p></div></div>`;
    return;
  }

  grid.innerHTML = data.map(investmentCardHTML).join("");
}

loadInvestments();
