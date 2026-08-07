// ==========================================
// AKINF2P AUTHENTICATION
// Requires js/supabaseClient.js to be loaded first (defines `supabaseClient`).
// ==========================================

/* ---------- Core auth actions ---------- */

async function signupUser() {
  const username = document.getElementById("signupUsername").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const errorEl = document.getElementById("signupError");

  if (errorEl) {
    errorEl.style.color = "#ff6b6b";
    errorEl.textContent = "";
  }

  if (!username || !email || !password) {
    if (errorEl) errorEl.textContent = "Please fill in all fields.";
    return;
  }

  if (password.length < 6) {
    if (errorEl) errorEl.textContent = "Password must be at least 6 characters.";
    return;
  }

  // Check username availability first so we can show a clear message —
  // otherwise a duplicate username fails deep in the database and
  // Supabase Auth only reports back a vague generic error.
  const { data: existingUsername } = await supabaseClient
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existingUsername) {
    if (errorEl) errorEl.textContent = "That username is already taken — please choose another.";
    return;
  }

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    if (errorEl) errorEl.textContent = error.message;
    return;
  }

  // Fire-and-forget welcome email — doesn't block the signup flow if it fails
  fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username }),
  }).catch(() => {});

  if (errorEl) {
    errorEl.style.color = "#4ade80";
    errorEl.textContent = "Account created! Check your email to verify, then log in.";
  }
}

async function loginUser() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");

  if (errorEl) errorEl.textContent = "";

  if (!email || !password) {
    if (errorEl) errorEl.textContent = "Enter your email and password.";
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    if (errorEl) errorEl.textContent = error.message;
    return;
  }

  window.location.href = "dashboard.html";
}

async function requestPasswordReset() {
  const email = document.getElementById("loginEmail").value.trim();
  const errorEl = document.getElementById("loginError");

  if (errorEl) errorEl.style.color = "#ff6b6b";

  if (!email) {
    if (errorEl) errorEl.textContent = "Enter your email above first, then click Forgot password.";
    return;
  }

  const redirectTo = window.location.origin + window.location.pathname.replace(/[^/]*$/, "reset-password.html");

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    if (errorEl) errorEl.textContent = error.message;
    return;
  }

  if (errorEl) {
    errorEl.style.color = "#4ade80";
    errorEl.textContent = "Check your email for a password reset link.";
  }
}

async function logoutUser() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

/* ---------- Shared helpers used across every page ---------- */

async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data ? data.user : null;
}

async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, username, avatar_url, role")
    .eq("id", user.id)
    .single();

  return error ? null : data;
}

async function getMembershipStatus() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data } = await supabaseClient
    .from("memberships")
    .select("status, period_end")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

async function isActiveMember() {
  const m = await getMembershipStatus();
  return !!(m && m.status === "active" && new Date(m.period_end) > new Date());
}

async function isStaff() {
  const p = await getCurrentProfile();
  return !!(p && (p.role === "owner" || p.role === "admin"));
}

async function getSessionToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

/* ---------- Route guards ----------
   Call at the top of a protected page. This is UX only — the
   real security boundary is the Row Level Security policies in
   Supabase, which apply no matter what this JS does or doesn't do. */

async function requireLogin(redirectTo = "index.html") {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = redirectTo;
    return null;
  }
  return user;
}

async function requireOwner(redirectTo = "index.html") {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "owner") {
    window.location.href = redirectTo;
    return null;
  }
  return profile;
}

window.AkinAuth = {
  signupUser,
  loginUser,
  logoutUser,
  requestPasswordReset,
  getCurrentUser,
  getCurrentProfile,
  getMembershipStatus,
  isActiveMember,
  isStaff,
  getSessionToken,
  requireLogin,
  requireOwner,
};

/* ---------- Wire up the account modal (index/investments/vip/community) ---------- */

(function setupAuthUI() {
  const accountBtn = document.getElementById("accountBtn");
  const accountModal = document.getElementById("accountModal");
  const closeModalBtn = document.getElementById("closeModal");
  const loginTab = document.getElementById("loginTab");
  const signupTab = document.getElementById("signupTab");
  const loginContent = document.getElementById("loginContent");
  const signupContent = document.getElementById("signupContent");

  if (loginTab && signupTab && loginContent && signupContent) {
    loginTab.addEventListener("click", () => {
      loginTab.classList.add("active");
      signupTab.classList.remove("active");
      loginContent.classList.add("active");
      signupContent.classList.remove("active");
    });

    signupTab.addEventListener("click", () => {
      signupTab.classList.add("active");
      loginTab.classList.remove("active");
      signupContent.classList.add("active");
      loginContent.classList.remove("active");
    });
  }

  if (accountBtn) {
    accountBtn.addEventListener("click", async () => {
      const profile = await getCurrentProfile();

      if (profile) {
        window.location.href = "dashboard.html";
        return;
      }

      if (accountModal) accountModal.style.display = "flex";
    });
  }

  if (closeModalBtn && accountModal) {
    closeModalBtn.addEventListener("click", () => {
      accountModal.style.display = "none";
    });

    accountModal.addEventListener("click", (e) => {
      if (e.target === accountModal) accountModal.style.display = "none";
    });
  }

  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.addEventListener("click", loginUser);

  const joinPlatformBtn = document.getElementById("joinPlatformBtn");
  if (joinPlatformBtn) joinPlatformBtn.addEventListener("click", signupUser);

  const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
  if (forgotPasswordBtn) forgotPasswordBtn.addEventListener("click", requestPasswordReset);

  // Password show/hide eye icon toggles
  document.querySelectorAll(".toggle-password-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetInput = document.getElementById(btn.dataset.target);
      if (!targetInput) return;

      const icon = btn.querySelector("i");
      const isHidden = targetInput.type === "password";

      targetInput.type = isHidden ? "text" : "password";

      if (icon) {
        icon.classList.toggle("fa-eye", !isHidden);
        icon.classList.toggle("fa-eye-slash", isHidden);
      }

      btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  });
})();
