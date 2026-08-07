// ==========================================================
// AKINF2P — OWNER DASHBOARD
// Every mutating action here calls a Supabase Edge Function
// that re-checks "is this really the owner?" server-side using
// the caller's real session token — this page's own guard below
// is just for UI/UX, not the actual security boundary.
// ==========================================================

function escapeHTMLLocal(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

async function initOwnerDashboard() {
  const profile = await getCurrentProfile();

  const deniedView = document.getElementById("ownerAccessDenied");
  const contentView = document.getElementById("ownerContent");

  if (!profile || profile.role !== "owner") {
    deniedView.style.display = "block";
    contentView.style.display = "none";
    return;
  }

  deniedView.style.display = "none";
  contentView.style.display = "block";

  await loadAnalytics();
  await loadMembersTable();
  await loadPaymentsTable();
  await loadInvestmentsTable();
}

/* ---------- analytics ---------- */

async function loadAnalytics() {
  const { count: totalUsers } = await supabaseClient.from("profiles").select("*", { count: "exact", head: true });

  const { count: admins } = await supabaseClient
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");

  const { count: activeMembers } = await supabaseClient
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .eq("status", "active")
    .gt("period_end", new Date().toISOString());

  const { count: messageCount } = await supabaseClient
    .from("chat_messages")
    .select("*", { count: "exact", head: true });

  const { data: allMemberships } = await supabaseClient.from("memberships").select("amount");
  const totalRevenue = (allMemberships || []).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { count: signupsWeek } = await supabaseClient
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo.toISOString());

  document.getElementById("statTotalUsers").textContent = totalUsers ?? "—";
  document.getElementById("statActiveMembers").textContent = activeMembers ?? "—";
  document.getElementById("statAdmins").textContent = admins ?? "—";
  document.getElementById("statMessages").textContent = messageCount ?? "—";
  document.getElementById("statRevenue").textContent = "R" + totalRevenue.toFixed(2);
  document.getElementById("statSignupsWeek").textContent = signupsWeek ?? "—";
}

/* ---------- generate codes ---------- */

(function setupGenerateCodes() {
  const btn = document.getElementById("genCodeBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const countInput = document.getElementById("genCodeCount");
    const errorEl = document.getElementById("genCodeError");
    const resultsEl = document.getElementById("genCodeResults");

    if (errorEl) errorEl.textContent = "";

    const count = Math.min(Math.max(parseInt(countInput.value, 10) || 1, 1), 100);
    const token = await getSessionToken();

    btn.disabled = true;
    btn.textContent = "Generating…";

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-redemption-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ count }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (errorEl) errorEl.textContent = result.error || "Could not generate codes.";
        return;
      }

      resultsEl.innerHTML = (result.codes || [])
        .map((c) => `<span class="code-chip">${c.code}</span>`)
        .join("");
    } catch (err) {
      if (errorEl) errorEl.textContent = "Something went wrong.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate";
    }
  });
})();

/* ---------- members table ---------- */

async function loadMembersTable() {
  const tbody = document.getElementById("membersTableBody");

  const { data: profiles, error: profilesError } = await supabaseClient
    .from("profiles")
    .select("id, username, role")
    .order("username", { ascending: true });

  if (profilesError) {
    tbody.innerHTML = `<tr><td colspan="4">Could not load members.</td></tr>`;
    return;
  }

  const { data: memberships } = await supabaseClient
    .from("memberships")
    .select("user_id, status, period_end")
    .order("created_at", { ascending: false });

  const latestMembershipByUser = {};
  (memberships || []).forEach((m) => {
    if (!latestMembershipByUser[m.user_id]) latestMembershipByUser[m.user_id] = m;
  });

  tbody.innerHTML = "";

  profiles.forEach((profile) => {
    const membership = latestMembershipByUser[profile.id];
    const isActiveMembership = membership && membership.status === "active" && new Date(membership.period_end) > new Date();
    const membershipLabel = isActiveMembership ? "✅ Active" : "—";

    const row = document.createElement("tr");

    let actionHTML = "";
    if (profile.role === "owner") {
      actionHTML = `<em>Owner</em>`;
    } else {
      actionHTML = `
        <select class="role-select" data-user-id="${profile.id}">
          <option value="member" ${profile.role === "member" ? "selected" : ""}>Member</option>
          <option value="admin" ${profile.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
        <button class="mini-btn save-role-btn" data-user-id="${profile.id}">Save</button>
      `;
    }

    row.innerHTML = `
      <td>${escapeHTMLLocal(profile.username)}</td>
      <td>${profile.role.toUpperCase()}</td>
      <td>${membershipLabel}</td>
      <td>${actionHTML}</td>
    `;

    tbody.appendChild(row);
  });

  tbody.querySelectorAll(".save-role-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.userId;
      const select = tbody.querySelector(`select[data-user-id="${userId}"]`);
      const newRole = select.value;

      btn.disabled = true;
      btn.textContent = "Saving…";

      const token = await getSessionToken();

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/set-user-role`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ target_user_id: userId, new_role: newRole }),
        });

        if (!res.ok) {
          const result = await res.json().catch(() => ({}));
          alert(result.error || "Could not update role.");
        } else {
          await loadMembersTable();
          await loadAnalytics();
        }
      } catch (err) {
        alert("Something went wrong.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });
  });
}

/* ---------- payments table ---------- */

async function loadPaymentsTable() {
  const tbody = document.getElementById("paymentsTableBody");

  const { data: payments, error } = await supabaseClient
    .from("memberships")
    .select("user_id, amount, status, period_end, profiles(username)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !payments) {
    tbody.innerHTML = `<tr><td colspan="4">Could not load payments.</td></tr>`;
    return;
  }

  if (payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No payments yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = payments
    .map((p) => {
      const username = p.profiles ? escapeHTMLLocal(p.profiles.username) : "—";
      const amount = p.amount != null ? `R${Number(p.amount).toFixed(2)}` : "—";
      const periodEnd = p.period_end ? new Date(p.period_end).toLocaleDateString() : "—";
      return `<tr><td>${username}</td><td>${amount}</td><td>${p.status}</td><td>${periodEnd}</td></tr>`;
    })
    .join("");
}

initOwnerDashboard();

/* ---------- VIP package settings ---------- */

async function loadPlanSettings() {
  const nameInput = document.getElementById("planNameInput");
  const priceInput = document.getElementById("planPriceInput");
  const featuresInput = document.getElementById("planFeaturesInput");
  if (!nameInput || !priceInput || !featuresInput) return;

  const { data: plan } = await supabaseClient
    .from("membership_plan")
    .select("name, price, features")
    .eq("id", 1)
    .single();

  if (!plan) return;

  nameInput.value = plan.name || "";
  priceInput.value = plan.price || "";
  featuresInput.value = Array.isArray(plan.features) ? plan.features.join("\n") : "";
}

(function setupPlanSettings() {
  const saveBtn = document.getElementById("planSettingsSaveBtn");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async () => {
    const name = document.getElementById("planNameInput").value.trim();
    const priceRaw = document.getElementById("planPriceInput").value;
    const featuresRaw = document.getElementById("planFeaturesInput").value;
    const errorEl = document.getElementById("planSettingsError");

    if (errorEl) errorEl.textContent = "";

    const price = parseFloat(priceRaw);

    if (!name) {
      if (errorEl) errorEl.textContent = "Plan name is required.";
      return;
    }

    if (isNaN(price) || price < 0) {
      if (errorEl) errorEl.textContent = "Enter a valid price.";
      return;
    }

    const features = featuresRaw
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const { error } = await supabaseClient
      .from("membership_plan")
      .update({ name, price, features, updated_at: new Date().toISOString() })
      .eq("id", 1);

    saveBtn.disabled = false;
    saveBtn.textContent = "Save Package Settings";

    if (error) {
      if (errorEl) errorEl.textContent = error.message;
      return;
    }

    if (errorEl) {
      errorEl.style.color = "#4ade80";
      errorEl.textContent = "Saved! Changes are live on the VIP page and future payments immediately.";
    }
  });
})();

loadPlanSettings();

/* ---------- investment management ---------- */

async function loadInvestmentsTable() {
  const tbody = document.getElementById("investmentsTableBody");
  if (!tbody) return;

  const { data, error } = await supabaseClient
    .from("investments")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3">Could not load picks.</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">No picks yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map(
      (inv) => `
      <tr>
        <td>${escapeHTMLLocal(inv.title)}</td>
        <td>${inv.status}</td>
        <td>
          <button class="mini-btn edit-inv-btn" data-id="${inv.id}">Edit</button>
          <button class="mini-btn danger delete-inv-btn" data-id="${inv.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll(".delete-inv-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this pick?")) return;
      await supabaseClient.from("investments").delete().eq("id", btn.dataset.id);
      await loadInvestmentsTable();
    });
  });

  tbody.querySelectorAll(".edit-inv-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inv = data.find((i) => i.id === btn.dataset.id);
      if (!inv) return;

      document.getElementById("invTitle").value = inv.title || "";
      document.getElementById("invDescription").value = inv.description || "";
      document.getElementById("invImageUrl").value = inv.image_url || "";
      document.getElementById("invStatus").value = inv.status || "coming_soon";
      document.getElementById("invEditId").value = inv.id;
      document.getElementById("invAddBtn").textContent = "Update Pick";
      const cancelBtn = document.getElementById("invCancelEditBtn");
      if (cancelBtn) cancelBtn.style.display = "inline-block";
      document.getElementById("invTitle").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

(function setupAddInvestment() {
  const btn = document.getElementById("invAddBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const title = document.getElementById("invTitle").value.trim();
    const description = document.getElementById("invDescription").value.trim();
    const imageUrl = document.getElementById("invImageUrl").value.trim();
    const status = document.getElementById("invStatus").value;
    const editIdField = document.getElementById("invEditId");
    const editId = editIdField ? editIdField.value : "";
    const errorEl = document.getElementById("invError");

    if (errorEl) errorEl.textContent = "";

    if (!title) {
      if (errorEl) errorEl.textContent = "Title is required.";
      return;
    }

    let error;

    if (editId) {
      // Update existing pick
      ({ error } = await supabaseClient
        .from("investments")
        .update({ title, description, image_url: imageUrl || null, status })
        .eq("id", editId));
    } else {
      // Add new pick
      const { data: existing } = await supabaseClient
        .from("investments")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1);
      const nextOrder = existing && existing[0] ? existing[0].sort_order + 1 : 1;

      ({ error } = await supabaseClient.from("investments").insert({
        title,
        description,
        image_url: imageUrl || null,
        status,
        sort_order: nextOrder,
      }));
    }

    if (error) {
      if (errorEl) errorEl.textContent = error.message;
      return;
    }

    document.getElementById("invTitle").value = "";
    document.getElementById("invDescription").value = "";
    document.getElementById("invImageUrl").value = "";
    if (editIdField) editIdField.value = "";
    btn.textContent = "Add Pick";
    const cancelBtn = document.getElementById("invCancelEditBtn");
    if (cancelBtn) cancelBtn.style.display = "none";
    await loadInvestmentsTable();
  });

  const cancelEditBtn = document.getElementById("invCancelEditBtn");
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      document.getElementById("invTitle").value = "";
      document.getElementById("invDescription").value = "";
      document.getElementById("invImageUrl").value = "";
      document.getElementById("invEditId").value = "";
      btn.textContent = "Add Pick";
      cancelEditBtn.style.display = "none";
    });
  }
})();
