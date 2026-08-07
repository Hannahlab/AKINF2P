/* ==========================================
   COMMUNITY CHANNEL SWITCHING
========================================== */

const channelButtons = document.querySelectorAll(".channel");
const channelPages = document.querySelectorAll(".channel-page");

const channelMap = {
  "general-btn": "general-channel",
  "announcements-btn": "announcements-channel",
  "giveaways-btn": "giveaways-channel",
  "vip-btn": "vip-channel",
};

channelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    channelButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    channelPages.forEach((page) => page.classList.remove("active"));

    const target = document.getElementById(channelMap[button.id]);
    if (target) target.classList.add("active");

    // The VIP Lounge's actual content (locked card vs. live chat) is
    // decided by community.js based on real membership status — this
    // just switches which panel is visible, it doesn't grant access.
    if (button.id === "vip-btn" && typeof updateVipAccessUI === "function") {
      updateVipAccessUI();
    }
  });
});

const defaultChannel = document.getElementById("general-channel");
if (defaultChannel) defaultChannel.classList.add("active");

/* ==========================================
   CHAT MESSAGE SENDING SYSTEM
========================================== */

const CHANNEL_KEY_BY_PAGE_ID = {
  "general-channel": "general",
  "vip-channel": "vip",
};

const messageInputs = document.querySelectorAll(".chat-message-input");
const sendButtons = document.querySelectorAll(".send-message-btn");

async function sendMessage(input) {
  const text = input.value.trim();
  if (!text) return;

  const activeChannel = input.closest(".channel-page");
  if (!activeChannel) return;

  const channelKey = CHANNEL_KEY_BY_PAGE_ID[activeChannel.id];
  if (!channelKey) return;

  const previewId = channelKey === "vip" ? "vipReplyPreview" : "replyPreview";
  const replyPreview = document.getElementById(previewId);

  let replyToId = null;
  if (replyPreview && replyPreview.classList.contains("active")) {
    replyToId = replyPreview.dataset.replyToId || null;
  }

  let image = null;
  if (window.pendingImageDataUrl) {
    image = window.pendingImageDataUrl;
    window.pendingImageDataUrl = null;
    if (typeof window.clearImagePreviewChip === "function") window.clearImagePreviewChip();
  }

  if (window.AkinCommunity && typeof window.AkinCommunity.sendChatMessage === "function") {
    const result = await window.AkinCommunity.sendChatMessage(channelKey, text, replyToId, image);
    if (result && result.error) return;
  }

  input.value = "";
  if (replyPreview) replyPreview.classList.remove("active");
}

sendButtons.forEach((button) => {
  button.addEventListener("click", function () {
    const input = this.parentElement.querySelector(".chat-message-input");
    sendMessage(input);
  });
});

messageInputs.forEach((input) => {
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage(this);
    }
  });
});
