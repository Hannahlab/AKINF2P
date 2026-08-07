// ==========================================
// AKINF2P — INJECTED FEATURES
// Emoji picker, image upload, search highlighting, online
// presence. Account modal + VIP access are handled for real in
// auth.js / community.js — this file has no fake auth logic.
// ==========================================

function showFeatureToast(text) {
  let toast = document.getElementById("featureToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "featureToast";
    toast.className = "feature-toast";
    document.body.appendChild(toast);
  }

  toast.innerText = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

/* ---------- hamburger menu (mobile/tablet nav) ---------- */

(function setupMobileMenu() {
  const toggleBtn = document.getElementById("mobileMenuToggle");
  const menu = document.getElementById("navMenu");
  if (!toggleBtn || !menu) return;

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
    const icon = toggleBtn.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-bars", !menu.classList.contains("open"));
      icon.classList.toggle("fa-xmark", menu.classList.contains("open"));
    }
  });

  // Close when clicking any link/button inside, or clicking outside
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a") || e.target.closest("button")) {
      menu.classList.remove("open");
    }
  });

  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("open")) return;
    if (!menu.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
      menu.classList.remove("open");
    }
  });
})();

/* ---------- emoji picker ---------- */

(function setupEmojiPicker() {
  const emojiToggleBtn = document.getElementById("emojiToggleBtn");
  const emojiPanel = document.getElementById("emojiPickerPanel");
  if (!emojiToggleBtn || !emojiPanel) return;

  const chatInput = emojiToggleBtn.closest(".chat-input-bar").querySelector(".chat-message-input");

  emojiToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPanel.classList.toggle("active");
  });

  emojiPanel.querySelectorAll(".emoji-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!chatInput) return;
      const start = chatInput.selectionStart || chatInput.value.length;
      const end = chatInput.selectionEnd || chatInput.value.length;
      const emoji = btn.textContent;
      chatInput.value = chatInput.value.slice(0, start) + emoji + chatInput.value.slice(end);
      const cursorPos = start + emoji.length;
      chatInput.focus();
      chatInput.setSelectionRange(cursorPos, cursorPos);
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#emojiPickerPanel") && !e.target.closest("#emojiToggleBtn")) {
      emojiPanel.classList.remove("active");
    }
  });
})();

/* ---------- image upload picker ---------- */

(function setupImageUpload() {
  const imageUploadBtn = document.getElementById("imageUploadBtn");
  const imageUploadInput = document.getElementById("imageUploadInput");
  const attachmentBtn = document.getElementById("attachmentBtn");
  if (!imageUploadBtn || !imageUploadInput) return;

  imageUploadBtn.addEventListener("click", () => imageUploadInput.click());

  // Paperclip button does the same thing as the image icon — one
  // shared file picker for attachments.
  if (attachmentBtn) {
    attachmentBtn.addEventListener("click", () => imageUploadInput.click());
  }

  imageUploadInput.addEventListener("change", () => {
    const file = imageUploadInput.files && imageUploadInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      window.pendingImageDataUrl = reader.result;
      showImagePreviewChip(file.name, imageUploadBtn);
    };
    reader.readAsDataURL(file);
  });
})();

function showImagePreviewChip(filename, anchorBtn) {
  let chip = document.getElementById("imagePreviewChip");

  if (!chip) {
    chip = document.createElement("div");
    chip.id = "imagePreviewChip";
    chip.style.position = "absolute";
    chip.style.bottom = "58px";
    chip.style.background = "#181008";
    chip.style.border = "1px solid rgba(134, 110, 67, 0.4)";
    chip.style.borderRadius = "20px";
    chip.style.padding = "8px 14px";
    chip.style.fontSize = "12px";
    chip.style.color = "#fff";
    chip.style.display = "flex";
    chip.style.alignItems = "center";
    chip.style.gap = "8px";
    chip.style.whiteSpace = "nowrap";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.style.background = "none";
    removeBtn.style.border = "none";
    removeBtn.style.color = "#bbb";
    removeBtn.style.cursor = "pointer";
    removeBtn.addEventListener("click", () => {
      window.pendingImageDataUrl = null;
      chip.remove();
    });

    chip.appendChild(document.createElement("span"));
    chip.appendChild(removeBtn);

    if (anchorBtn && anchorBtn.parentElement) {
      anchorBtn.parentElement.style.position = anchorBtn.parentElement.style.position || "relative";
      anchorBtn.parentElement.appendChild(chip);
    }
  }

  chip.querySelector("span").textContent = "📎 " + filename;
}

window.clearImagePreviewChip = function () {
  const chip = document.getElementById("imagePreviewChip");
  if (chip) chip.remove();
};

/* ---------- online presence (shows the real logged-in user on this device) ---------- */

(function setupOnlinePresence() {
  const list = document.getElementById("onlineMembersList");
  if (!list) return;

  async function render() {
    const profile = typeof getCurrentProfile === "function" ? await getCurrentProfile() : null;

    // Clear immediately before appending (not before the async fetch above) —
    // otherwise two overlapping calls to render() (which happens when
    // Supabase fires multiple auth state events on login) can each clear
    // and then both append, leaving the name duplicated.
    list.innerHTML = "";

    const me = document.createElement("div");
    me.className = "member";
    me.textContent = "🟢 " + (profile ? profile.username : "You (Guest)");
    list.appendChild(me);
  }

  render();

  if (typeof supabaseClient !== "undefined") {
    supabaseClient.auth.onAuthStateChange(() => render());
  }
})();

/* ---------- live search filter + highlight (#General) ---------- */

(function setupSearchFilter() {
  const searchInput = document.getElementById("generalSearchInput");
  const messagesContainer = document.getElementById("generalMessages");
  if (!searchInput || !messagesContainer) return;

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function escapeHTMLLocal(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function applyFilter() {
    const query = searchInput.value.trim();
    const lowerQuery = query.toLowerCase();

    messagesContainer.querySelectorAll(".message").forEach((msg) => {
      const textEl = msg.querySelector(".message-content p");
      if (!textEl) return;

      if (textEl.dataset.rawText === undefined) {
        textEl.dataset.rawText = textEl.textContent;
      }

      const raw = textEl.dataset.rawText;

      if (!query) {
        textEl.textContent = raw;
        msg.classList.remove("search-hidden");
        return;
      }

      if (raw.toLowerCase().includes(lowerQuery)) {
        msg.classList.remove("search-hidden");
        const escaped = escapeHTMLLocal(raw);
        const pattern = new RegExp(escapeRegExp(query), "gi");
        textEl.innerHTML = escaped.replace(pattern, (match) => `<mark class="search-highlight">${match}</mark>`);
      } else {
        msg.classList.add("search-hidden");
      }
    });
  }

  searchInput.addEventListener("input", applyFilter);

  const observer = new MutationObserver(applyFilter);
  observer.observe(messagesContainer, { childList: true });
})();
