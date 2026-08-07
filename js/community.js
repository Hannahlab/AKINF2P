// ==========================================================
// AKINF2P COMMUNITY SYSTEM — real-time chat via Supabase
// Requires js/supabaseClient.js and js/auth.js loaded first.
// ==========================================================

const REACTION_EMOJIS = [
  "👍", "❤️", "😂", "🔥", "👏", "😍",
  "😮", "😢", "😡", "💯", "🎉", "🚀",
  "⚽", "🏆", "💰", "👑", "🤝", "🙌",
];

const CHANNELS = {
  general: { containerId: "generalMessages" },
  vip: { containerId: "vipMessages" },
};

const profileCache = {};
const messageCache = {};
const reactionsCache = {};
const activeSubscriptions = {};

let vipChatInitialized = false;
let currentUserId = null;

/* ---------- helpers ---------- */

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function reactionTrayHTML() {
  return REACTION_EMOJIS.map((emoji) => `<button class="react-emoji">${emoji}</button>`).join("");
}

async function getProfile(userId) {
  if (profileCache[userId]) return profileCache[userId];

  const { data } = await supabaseClient
    .from("profiles")
    .select("id, username, avatar_url, role")
    .eq("id", userId)
    .single();

  const profile = data || { id: userId, username: "Member", avatar_url: null, role: "member" };
  profileCache[userId] = profile;
  return profile;
}

function emptyStateHTML() {
  return `
    <div class="empty-chat-state">
      <i class="fa-regular fa-comments"></i>
      <p>No messages yet — be the first to say hello 👋</p>
    </div>`;
}

function isOwnerOrAdminCached() {
  const profile = currentUserId ? profileCache[currentUserId] : null;
  return !!(profile && (profile.role === "owner" || profile.role === "admin"));
}

/* ---------- rendering ---------- */

async function messageTemplate(row) {
  const profile = await getProfile(row.user_id);
  messageCache[row.id] = Object.assign({}, row, { profile });

  const isOwner = profile.role === "owner";
  const isAdmin = profile.role === "admin";
  const roleLabel = isOwner ? "OWNER" : isAdmin ? "ADMIN" : "MEMBER";
  const roleClass = isOwner ? "owner-role" : isAdmin ? "admin-role" : "mod-role";

  let replyHTML = "";
  if (row.reply_to_id && messageCache[row.reply_to_id]) {
    const parent = messageCache[row.reply_to_id];
    replyHTML = `
      <div class="reply-quote">
        <i class="fa-solid fa-reply"></i>
        Replying to <strong>${escapeHTML(parent.profile.username)}</strong>: "${escapeHTML(parent.text)}"
      </div>`;
  }

  const imageHTML = row.image_url
    ? `<div class="message-image-preview"><img src="${row.image_url}" alt="attachment"></div>`
    : "";

  const canModerate = currentUserId && isOwnerOrAdminCached();
  const isOwnMessage = currentUserId && row.user_id === currentUserId;
  const canDelete = canModerate || isOwnMessage;

  return `
<div class="message" data-msg-id="${row.id}" data-channel="${row.channel}">

  <div class="message-hover-actions">
    <button class="hover-action-btn react-btn" title="React"><i class="fa-regular fa-face-smile"></i></button>
    <button class="hover-action-btn reply-btn" title="Reply"><i class="fa-solid fa-reply"></i></button>
    <button class="hover-action-btn copy-btn" title="Copy"><i class="fa-regular fa-copy"></i></button>
    <button class="hover-action-btn report-btn" title="Report"><i class="fa-solid fa-flag"></i></button>
    ${canDelete ? `<button class="hover-action-btn delete-btn" title="${canModerate && !isOwnMessage ? "Delete (moderator)" : "Unsend"}"><i class="fa-solid fa-trash"></i></button>` : ""}
  </div>

  <div class="hover-react-tray">${reactionTrayHTML()}</div>

  <div class="community-avatar ${isOwner ? "owner-avatar" : ""}">
    <img src="${profile.avatar_url || "assets/avatars/default-avatar.png"}" alt="${escapeHTML(profile.username)}">
  </div>

  <div class="message-content">
    ${replyHTML}

    <div class="message-top">
      <span class="username ${isOwner ? "owner" : ""}">${isOwner ? "👑 " : ""}${escapeHTML(profile.username)}</span>
      <span class="role ${roleClass}">${roleLabel}</span>
    </div>

    <p>${escapeHTML(row.text)}</p>
    ${imageHTML}

    <div class="message-reactions" id="reactions-${row.id}"></div>
  </div>
</div>`;
}

function renderReactionsForMessage(messageId) {
  const el = document.getElementById(`reactions-${messageId}`);
  if (!el) return;

  const grouped = reactionsCache[messageId] || {};
  const badges = Object.keys(grouped)
    .filter((emoji) => grouped[emoji].size > 0)
    .map((emoji) => {
      const count = grouped[emoji].size;
      const mine = currentUserId && grouped[emoji].has(currentUserId);
      return `<button class="reaction${mine ? " reaction-mine" : ""}" data-emoji="${emoji}">${emoji} ${count}</button>`;
    })
    .join("");

  el.innerHTML = badges;
}

function addReactionToCache(row) {
  if (!reactionsCache[row.message_id]) reactionsCache[row.message_id] = {};
  if (!reactionsCache[row.message_id][row.emoji]) reactionsCache[row.message_id][row.emoji] = new Set();
  reactionsCache[row.message_id][row.emoji].add(row.user_id);
}

function removeReactionFromCache(row) {
  const forMsg = reactionsCache[row.message_id];
  if (!forMsg) return;
  Object.keys(forMsg).forEach((emoji) => forMsg[emoji].delete(row.user_id));
}

/* ---------- load + subscribe ---------- */

async function loadChannelMessages(channelKey) {
  const config = CHANNELS[channelKey];
  const container = document.getElementById(config.containerId);
  if (!container) return;

  container.innerHTML = `<div class="empty-chat-state"><p>Loading messages…</p></div>`;

  const { data: rows, error } = await supabaseClient
    .from("chat_messages")
    .select("*")
    .eq("channel", channelKey)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    container.innerHTML = `<div class="empty-chat-state"><p>Couldn't load messages (${escapeHTML(error.message)})</p></div>`;
    return;
  }

  if (!rows || rows.length === 0) {
    container.innerHTML = emptyStateHTML();
  } else {
    const parts = [];
    for (const row of rows) parts.push(await messageTemplate(row));
    container.innerHTML = parts.join("");

    const ids = rows.map((r) => r.id);
    const { data: reactions } = await supabaseClient.from("message_reactions").select("*").in("message_id", ids);
    (reactions || []).forEach(addReactionToCache);
    ids.forEach(renderReactionsForMessage);
  }

  container.scrollTop = container.scrollHeight;
}

function subscribeToChannel(channelKey) {
  if (activeSubscriptions[channelKey]) return;
  const config = CHANNELS[channelKey];

  const sub = supabaseClient
    .channel(`chat-${channelKey}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `channel=eq.${channelKey}` },
      async (payload) => {
        const container = document.getElementById(config.containerId);
        if (!container) return;
        const emptyState = container.querySelector(".empty-chat-state");
        if (emptyState) container.innerHTML = "";
        const html = await messageTemplate(payload.new);
        container.insertAdjacentHTML("beforeend", html);
        container.scrollTop = container.scrollHeight;
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "chat_messages", filter: `channel=eq.${channelKey}` },
      (payload) => {
        const el = document.querySelector(`.message[data-msg-id="${payload.old.id}"]`);
        if (el) el.remove();
      }
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
      addReactionToCache(payload.new);
      renderReactionsForMessage(payload.new.message_id);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
      removeReactionFromCache(payload.old);
      renderReactionsForMessage(payload.old.message_id);
    })
    .subscribe();

  activeSubscriptions[channelKey] = sub;
}

/* ---------- sending ---------- */

async function sendChatMessage(channelKey, text, replyToId, imageDataUrl) {
  const user = await getCurrentUser();

  if (!user) {
    showFeatureToast("⚠️ Please log in to send a message.");
    return { error: "not_logged_in" };
  }

  const { error } = await supabaseClient.from("chat_messages").insert({
    channel: channelKey,
    user_id: user.id,
    text,
    reply_to_id: replyToId || null,
    image_url: imageDataUrl || null,
  });

  if (error) {
    showFeatureToast("⚠️ " + error.message);
    return { error };
  }

  return { success: true };
}

window.AkinCommunity = { sendChatMessage };

/* ---------- mobile slide-in panels (channels / members) ---------- */

(function setupMobilePanels() {
  const channelsToggle = document.getElementById("toggleChannelsBtn");
  const membersToggle = document.getElementById("toggleMembersBtn");
  const overlay = document.getElementById("mobilePanelOverlay");
  const sidebar = document.getElementById("communitySidebar");
  const membersSidebar = document.getElementById("membersSidebar");

  if (!channelsToggle || !membersToggle || !overlay || !sidebar || !membersSidebar) return;

  function closeAll() {
    sidebar.classList.remove("open");
    membersSidebar.classList.remove("open");
    overlay.classList.remove("active");
  }

  channelsToggle.addEventListener("click", () => {
    const willOpen = !sidebar.classList.contains("open");
    closeAll();
    if (willOpen) {
      sidebar.classList.add("open");
      overlay.classList.add("active");
    }
  });

  membersToggle.addEventListener("click", () => {
    const willOpen = !membersSidebar.classList.contains("open");
    closeAll();
    if (willOpen) {
      membersSidebar.classList.add("open");
      overlay.classList.add("active");
    }
  });

  overlay.addEventListener("click", closeAll);

  // Selecting a channel closes the panel so the chat is visible
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest(".channel")) closeAll();
  });
})();

/* ---------- VIP access (real membership check) ---------- */

async function updateVipAccessUI() {
  const lockedView = document.getElementById("vipLockedView");
  const chatView = document.getElementById("vipMessages");
  const inputBar = document.getElementById("vipInputBar");
  const replyPreview = document.getElementById("vipReplyPreview");

  if (!lockedView || !chatView) return;

  const hasAccess = (await isActiveMember()) || (await isStaff());

  if (hasAccess) {
    lockedView.style.display = "none";
    chatView.style.display = "block";
    if (inputBar) inputBar.style.display = "flex";

    if (!vipChatInitialized) {
      vipChatInitialized = true;
      await loadChannelMessages("vip");
      subscribeToChannel("vip");
    }
  } else {
    lockedView.style.display = "block";
    chatView.style.display = "none";
    if (inputBar) inputBar.style.display = "none";
    if (replyPreview) replyPreview.classList.remove("active");
  }
}

/* ---------- init ---------- */

async function initCommunity() {
  const generalContainer = document.getElementById("generalMessages");
  if (!generalContainer) return;

  const user = await getCurrentUser();
  currentUserId = user ? user.id : null;
  if (currentUserId) await getProfile(currentUserId);

  await loadChannelMessages("general");
  subscribeToChannel("general");
  await updateVipAccessUI();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUserId = session && session.user ? session.user.id : null;
    if (currentUserId) {
      delete profileCache[currentUserId];
      await getProfile(currentUserId);
    }
    await updateVipAccessUI();
  });
}

initCommunity();

/* ---------- hover action bar: react / reply / copy / report / delete ---------- */

document.addEventListener("click", async function (e) {
  const message = e.target.closest(".message");

  const reactBtn = e.target.closest(".react-btn");
  if (reactBtn && message) {
    e.stopPropagation();
    const tray = message.querySelector(".hover-react-tray");
    document.querySelectorAll(".hover-react-tray.active").forEach((t) => {
      if (t !== tray) t.classList.remove("active");
    });
    if (tray) tray.classList.toggle("active");
    return;
  }

  const emojiChoice = e.target.closest(".react-emoji");
  if (emojiChoice && message) {
    e.stopPropagation();

    const user = await getCurrentUser();
    if (!user) {
      showFeatureToast("⚠️ Please log in to react.");
      return;
    }

    const emoji = emojiChoice.textContent;
    const messageId = message.dataset.msgId;
    const mine = reactionsCache[messageId] && reactionsCache[messageId][emoji] && reactionsCache[messageId][emoji].has(user.id);

    if (mine) {
      await supabaseClient.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", user.id).eq("emoji", emoji);
    } else {
      await supabaseClient.from("message_reactions").upsert(
        { message_id: messageId, user_id: user.id, emoji },
        { onConflict: "message_id,user_id" }
      );
    }

    const tray = message.querySelector(".hover-react-tray");
    if (tray) tray.classList.remove("active");
    return;
  }

  const replyBtn = e.target.closest(".reply-btn");
  if (replyBtn && message) {
    e.stopPropagation();

    const channelKey = message.dataset.channel;
    const cached = messageCache[message.dataset.msgId];
    const username = cached ? cached.profile.username : "User";
    const text = cached ? cached.text : "";

    const previewId = channelKey === "vip" ? "vipReplyPreview" : "replyPreview";
    const nameId = channelKey === "vip" ? "vipReplyName" : "replyName";
    const textId = channelKey === "vip" ? "vipReplyText" : "replyText";

    const replyPreview = document.getElementById(previewId);
    const replyName = document.getElementById(nameId);
    const replyText = document.getElementById(textId);

    if (replyPreview && replyName && replyText) {
      replyName.innerText = "Replying to " + username;
      replyText.innerText = text;
      replyPreview.classList.add("active");
      replyPreview.dataset.replyToId = message.dataset.msgId;
    }
    return;
  }

  const copyBtn = e.target.closest(".copy-btn");
  if (copyBtn && message) {
    e.stopPropagation();
    const cached = messageCache[message.dataset.msgId];
    navigator.clipboard.writeText(cached ? cached.text : "");
    showToast("✅ Message copied");
    return;
  }

  const reportBtn = e.target.closest(".report-btn");
  if (reportBtn && message) {
    e.stopPropagation();
    showReportToast();
    return;
  }

  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn && message) {
    e.stopPropagation();
    const messageId = message.dataset.msgId;
    const { error } = await supabaseClient.from("chat_messages").delete().eq("id", messageId);
    if (!error) {
      message.remove();
    } else {
      showFeatureToast("⚠️ Could not delete message.");
    }
    return;
  }

  if (!e.target.closest(".hover-react-tray")) {
    document.querySelectorAll(".hover-react-tray.active").forEach((t) => t.classList.remove("active"));
  }
});

[
  { btnId: "cancelReply", previewId: "replyPreview" },
  { btnId: "vipCancelReply", previewId: "vipReplyPreview" },
].forEach(({ btnId, previewId }) => {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.addEventListener("click", () => {
      const preview = document.getElementById(previewId);
      if (preview) preview.classList.remove("active");
    });
  }
});

/* ---------- VIP code redemption ---------- */

(function setupVipRedeem() {
  const toggleBtn = document.getElementById("vipRedeemToggleBtn");
  const box = document.getElementById("vipRedeemBox");

  if (toggleBtn && box) {
    toggleBtn.addEventListener("click", () => {
      box.style.display = box.style.display === "none" ? "block" : "none";
    });
  }

  const submitBtn = document.getElementById("vipRedeemSubmitBtn");
  if (!submitBtn) return;

  submitBtn.addEventListener("click", async () => {
    const codeInput = document.getElementById("vipRedeemCodeInput");
    const errorEl = document.getElementById("vipRedeemError");
    const code = codeInput ? codeInput.value.trim() : "";

    if (errorEl) {
      errorEl.style.color = "#ff6b6b";
      errorEl.textContent = "";
    }

    const user = await getCurrentUser();
    if (!user) {
      if (errorEl) errorEl.textContent = "Please log in first.";
      return;
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

      if (codeInput) codeInput.value = "";
      if (errorEl) {
        errorEl.style.color = "#4ade80";
        errorEl.textContent = "🔓 VIP Lounge unlocked!";
      }
      await updateVipAccessUI();
    } catch (err) {
      if (errorEl) errorEl.textContent = "Something went wrong. Try again.";
    }
  });
})();

function showToast(text) {
  const toast = document.getElementById("copyToast");
  if (!toast) return;
  toast.innerText = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function showReportToast() {
  const reportToast = document.getElementById("reportToast");
  if (!reportToast) return;
  reportToast.classList.add("show");
  setTimeout(() => reportToast.classList.remove("show"), 2000);
}
