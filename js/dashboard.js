// ==========================================================
// AKINF2P — USER DASHBOARD
// ==========================================================

async function initDashboard() {
  const user = await getCurrentUser();

  const loggedOutView = document.getElementById("dashboardLoggedOut");
  const contentView = document.getElementById("dashboardContent");

  if (!user) {
    loggedOutView.style.display = "block";
    contentView.style.display = "none";
    return;
  }

  loggedOutView.style.display = "none";
  contentView.style.display = "block";

  await renderProfile();
  await renderMembership();
}

async function renderProfile() {
  const profile = await getCurrentProfile();
  if (!profile) return;

  document.getElementById("dashUsername").textContent = profile.username;
  document.getElementById("dashAvatarImg").src = profile.avatar_url || "assets/avatars/default-avatar.png";

  const settingsUsername = document.getElementById("settingsUsername");
  if (settingsUsername) settingsUsername.value = profile.username;

  const roleBadge = document.getElementById("dashRoleBadge");
  const roleLabel = profile.role === "owner" ? "OWNER" : profile.role === "admin" ? "ADMIN" : "MEMBER";
  const roleClass = profile.role === "owner" ? "owner-role" : profile.role === "admin" ? "admin-role" : "mod-role";
  roleBadge.textContent = roleLabel;
  roleBadge.className = "role-badge " + roleClass;

  const ownerLink = document.getElementById("ownerDashboardLink");
  if (ownerLink) ownerLink.style.display = profile.role === "owner" ? "inline" : "none";
}

async function renderMembership() {
  const membership = await getMembershipStatus();
  const badge = document.getElementById("membershipStatusBadge");
  const details = document.getElementById("membershipDetails");
  const joinBtn = document.getElementById("dashJoinProBtn");

  const { data: plan } = await supabaseClient
    .from("membership_plan")
    .select("name, price")
    .eq("id", 1)
    .single();

  const planName = plan ? plan.name : "Akinf2p Pro";
  const planPrice = plan ? Number(plan.price).toFixed(2) : "59.99";

  const isActive = membership && membership.status === "active" && new Date(membership.period_end) > new Date();

  if (isActive) {
    badge.textContent = `✅ ${planName} — Active`;
    badge.className = "membership-status active";
    const expiry = new Date(membership.period_end);
    details.textContent = `Renews / expires on ${expiry.toLocaleDateString()}.`;
    joinBtn.textContent = "🔄 Manage / Renew Membership";
  } else {
    badge.textContent = "Not active";
    badge.className = "membership-status inactive";
    details.textContent = "You don't have an active membership yet.";
    joinBtn.textContent = `🚀 Join ${planName} — R${planPrice}/month`;
  }
}

/* ---------- account settings ---------- */

(function setupSettings() {
  const btn = document.getElementById("settingsSaveBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const input = document.getElementById("settingsUsername");
    const errorEl = document.getElementById("settingsError");
    const username = input ? input.value.trim() : "";

    if (errorEl) {
      errorEl.style.color = "#ff6b6b";
      errorEl.textContent = "";
    }

    if (!username) {
      if (errorEl) errorEl.textContent = "Username can't be empty.";
      return;
    }

    const user = await getCurrentUser();
    if (!user) return;

    const { error } = await supabaseClient.from("profiles").update({ username }).eq("id", user.id);

    if (error) {
      if (errorEl) errorEl.textContent = error.message;
      return;
    }

    if (errorEl) {
      errorEl.style.color = "#4ade80";
      errorEl.textContent = "Saved!";
    }
    await renderProfile();
  });
})();

/* ---------- avatar upload ---------- */

(function setupAvatarUpload() {
  const uploadBtn = document.getElementById("avatarUploadBtn");
  const uploadInput = document.getElementById("avatarUploadInput");
  if (!uploadBtn || !uploadInput) return;

  uploadBtn.addEventListener("click", () => uploadInput.click());

  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files && uploadInput.files[0];
    if (!file) return;

    const user = await getCurrentUser();
    if (!user) return;

    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabaseClient.storage.from("avatars").upload(path, file, { upsert: true });

    if (uploadError) {
      alert("Upload failed: " + uploadError.message);
      return;
    }

    const { data: publicUrlData } = supabaseClient.storage.from("avatars").getPublicUrl(path);
    const publicUrl = publicUrlData.publicUrl + "?t=" + Date.now();

    const { error: updateError } = await supabaseClient.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);

    if (updateError) {
      alert("Could not save profile picture: " + updateError.message);
      return;
    }

    document.getElementById("dashAvatarImg").src = publicUrl;
  });
})();

/* ---------- logout ---------- */

(function setupLogout() {
  const logoutLink = document.getElementById("logoutLink");
  if (logoutLink) logoutLink.addEventListener("click", () => logoutUser());
})();

/* ---------- join / renew membership ---------- */

(function setupJoinButton() {
  const joinBtn = document.getElementById("dashJoinProBtn");
  if (!joinBtn) return;

  joinBtn.addEventListener("click", async () => {
    const user = await getCurrentUser();
    if (!user) return;

    joinBtn.disabled = true;
    joinBtn.textContent = "Redirecting…";

    try {
      const token = await getSessionToken();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/initiate-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: user.email, user_id: user.id }),
      });

      const result = await res.json();

      if (!res.ok || !result.authorization_url) {
        alert("Could not start checkout. Please try again.");
        joinBtn.disabled = false;
        return;
      }

      window.location.href = result.authorization_url;
    } catch (err) {
      alert("Something went wrong. Please try again.");
      joinBtn.disabled = false;
    }
  });
})();

/* ---------- redeem VIP code ---------- */

(function setupRedeem() {
  const btn = document.getElementById("dashRedeemBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const input = document.getElementById("dashRedeemCodeInput");
    const errorEl = document.getElementById("dashRedeemError");
    const code = input ? input.value.trim() : "";

    if (errorEl) {
      errorEl.style.color = "#ff6b6b";
      errorEl.textContent = "";
    }

    if (!code) {
      if (errorEl) errorEl.textContent = "Enter your code.";
      return;
    }

    const token = await getSessionToken();

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/claim-redemption-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (errorEl) errorEl.textContent = result.error || "Invalid or already-used code.";
        return;
      }

      if (input) input.value = "";
      if (errorEl) {
        errorEl.style.color = "#4ade80";
        errorEl.textContent = "🔓 VIP access unlocked!";
      }
      await renderMembership();
    } catch (err) {
      if (errorEl) errorEl.textContent = "Something went wrong. Try again.";
    }
  });
})();

initDashboard();
