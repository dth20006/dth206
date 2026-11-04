
// ==========================================
// ORDER BACKUP & RECENT ORDERS (Chống mất đơn & Tra cứu nhanh)
// ==========================================
function saveRecentOrder(order) {
  if (!order || !order.order_id) return;
  try {
    let recent = JSON.parse(localStorage.getItem("dth_recent_orders") || "[]");
    recent = recent.filter(o => o.order_id !== order.order_id);
    recent.unshift({
      order_id: order.order_id,
      package_name: order.package_name || "Dịch vụ",
      amount_formatted: order.amount_formatted || (order.amount ? Number(order.amount).toLocaleString("vi-VN") + "đ" : ""),
      status: order.status || "PENDING",
      created_time: order.created_time || new Date().toLocaleString("vi-VN")
    });
    if (recent.length > 10) recent = recent.slice(0, 10);
    localStorage.setItem("dth_recent_orders", JSON.stringify(recent));
  } catch (e) {
    console.error("Could not save recent order:", e);
  }
}

// Helper an toàn cho fetch JSON (Chống SyntaxError: The string did not match the expected pattern trên Safari khi gặp 500 HTML)
async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    if (!res.ok) {
      throw new Error(`Máy chủ phản hồi lỗi (${res.status}). Vui lòng thử lại sau!`);
    }
    throw new Error("Phản hồi từ máy chủ không đúng định dạng JSON.");
  }
  return { res, data };
}

function renderRecentOrdersSuggestion() {
  const container = document.getElementById("lookupResultsContainer");
  const input = document.getElementById("lookupInput");
  if (!container || !input) return;
  if (input.value.trim() !== "") return;

  try {
    const recent = JSON.parse(localStorage.getItem("dth_recent_orders") || "[]");
    if (!recent || recent.length === 0) return;

    let html = `
      <div style="margin-bottom: 20px; padding: 14px 16px; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px;">
        <div style="font-weight: 700; font-size: 0.9rem; color: #334155; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
          <span><i class="fa-solid fa-clock-rotate-left text-blue"></i> Đơn hàng gần đây của bạn:</span>
          <button type="button" onclick="localStorage.removeItem('dth_recent_orders'); renderRecentOrdersSuggestion();" style="border:none;background:none;color:#94a3b8;font-size:0.75rem;cursor:pointer;">Xóa lịch sử</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
    `;
    recent.forEach(r => {
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer; transition: all 0.2s;" onclick="runOrderLookup('${r.order_id}')" onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='#cbd5e1'">
          <div>
            <span style="font-weight: 800; color: #1e40af; font-size: 0.9rem;">${r.order_id}</span>
            <span style="color: #64748b; font-size: 0.8rem; margin-left: 8px;">${r.package_name}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: #d97706; font-size: 0.85rem;">${r.amount_formatted}</span>
            <span style="background: #2563eb; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">Xem</span>
          </div>
        </div>
      `;
    });
    html += `
        </div>
      </div>
    `;
    container.innerHTML = html;
  } catch (e) {
    console.error("renderRecentOrdersSuggestion error:", e);
  }
}

async function refreshOrderProgress(orderId) {
  showToast("Đang đồng bộ tiến độ thực tế từ máy chủ...", "info");
  try {
    const res = await fetch(`/api/order/sync-progress/${encodeURIComponent(orderId)}?t=${Date.now()}`);
    const data = await res.json();
    if (data.success && data.order) {
      showToast("Đã cập nhật tiến độ mới nhất!", "success");
      renderLookupResults([data.order]);
      return;
    }
  } catch (e) {
    console.error("sync-progress error:", e);
  }
  // Fallback sang runOrderLookup
  runOrderLookup(orderId);
}


// ==========================================
// PENDING ORDER & VIETQR DOWNLOAD HELPERS
// ==========================================
let gPaymentEndTime = 0;
let gCurrentOrderId = null;

function savePendingOrder(order) {
  try {
    const payload = {
      ...order,
      savedAt: Date.now()
    };
    localStorage.setItem("dth_pending_order", JSON.stringify(payload));
  } catch (e) {}
}

function clearPendingOrder() {
  try {
    localStorage.removeItem("dth_pending_order");
  } catch (e) {}
}

function getSavedPendingOrder() {
  try {
    const raw = localStorage.getItem("dth_pending_order");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function checkAndRestorePendingOrder() {
  const pending = getSavedPendingOrder();
  if (pending && pending.order_id) {
    const age = Date.now() - (pending.savedAt || 0);
    if (age < 15 * 60 * 1000) {
      openPaymentModal(pending);
    } else {
      clearPendingOrder();
    }
  }
}

function downloadQrImage() {
  const qrImg = document.getElementById("qrImage") || document.getElementById("payModalQrImg");
  const orderId = document.getElementById("payModalOrderId")?.textContent?.trim() || "DTH_VIETQR";
  if (!qrImg || !qrImg.src) {
    showToast("Không tìm thấy mã QR để tải về.", "error");
    return;
  }
  fetch(qrImg.src)
    .then(r => r.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `VietQR_${orderId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast("Đã lưu mã QR VietQR về máy!", "success");
    })
    .catch(() => {
      window.open(qrImg.src, "_blank");
    });
}

function applyButtonCooldown(btn, seconds = 4, loadingText = "Đang xử lý...") {
  if (!btn || btn.disabled) return false;
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${loadingText}</span>`;
  let left = seconds;
  const timer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }, 1000);
  return () => {
    clearInterval(timer);
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  };
}

// Background tab switch listener (iOS & Android tab-suspend prevention)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const modal = document.getElementById("paymentModal");
    const isModalOpen = modal && modal.style.display !== "none";
    if (isModalOpen && gCurrentOrderId) {
      // Immediate bank status check
      fetch(`/api/payment/check/${gCurrentOrderId}`)
        .then(r => r.json())
        .then(data => {
          if (data.success && data.status && data.status !== "PENDING") {
            handlePaymentSuccess(data.order || { order_id: gCurrentOrderId, status: data.status });
          }
        })
        .catch(() => {});

      // Recalculate countdown display based on actual timestamp
      if (gPaymentEndTime > 0) {
        const leftSec = Math.max(0, Math.floor((gPaymentEndTime - Date.now()) / 1000));
        const min = Math.floor(leftSec / 60);
        const sec = leftSec % 60;
        const display = document.getElementById("payModalCountdown");
        if (display) {
          display.textContent = `${min < 10 ? "0" : ""}${min}:${sec < 10 ? "0" : ""}${sec}`;
        }
      }
    }
  }
});


/**
 * DTH Portal - Unified Frontend JavaScript
 * Integrates Chung Sức LQ, Locket Gold, Dịch vụ MXH & Smart VietQR Modal
 */

// Global State
let gConfig = {};
let gChungSucPackages = {};
let gSelectedCsPkg = "full_3_ruong";
let gLocketSelectedPkg = "with_dns";
let gLocketUser = null;
let gMxhFeatured = [];
let gMxhServices = [];
let gMxhSelectedService = null;
let gMxhPlatform = "tiktok";
let gMxhAction = "all";
let gMxhOrigin = "all";
let gCurrentOrder = null;
let gPayPollTimer = null;
let gCountdownTimer = null;
let gOrderTrackingTimer = null;
let gTrackedOrderId = "";
let gTrackedOrderStatus = "";
let gTrackingRequestInFlight = false;

function cleanLocketUser(val) {
  if (!val) return "";
  let s = String(val).trim();
  if (s.includes("locket.cam/")) {
    const parts = s.split("locket.cam/");
    s = parts[1] || "";
  }
  s = s.replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "");
  return s;
}

function isCommentService(s) {
  if (!s) return false;
  const act = String(s.action || "").toLowerCase();
  const cat = String(s.category || "").toLowerCase();
  const name = String(s.name || "").toLowerCase();
  return act === "comment" || cat.includes("bình luận") || cat.includes("comment") || name.includes("comment") || name.includes("bình luận");
}


// ==========================================
// BULLETPROOF TAB SWITCHER & DEEP LINKING
// ==========================================
function normalizeTabKey(tabId) {
  if (!tabId || typeof tabId !== "string") return "chungsuc";
  let key = tabId.trim().toLowerCase();
  key = key.replace(/^#+/, "");
  key = key.replace(/^panel-/, "").replace(/^tab-/, "").replace(/^mobile-tab-/, "");
  key = key.replace(/-panel$/, "").replace(/-tab$/, "");
  if (key === "cs" || key === "lienquan" || key === "chung-suc") key = "chungsuc";
  if (key === "locketgold" || key === "gold") key = "locket";
  if (key === "social" || key === "mangxahoi") key = "mxh";
  if (key === "market" || key === "chopremium") key = "premium";
  if (key === "freetools" || key === "tool") key = "tools";
  if (key === "donhang" || key === "order" || key === "orders" || key === "tracuu") key = "lookup";
  return key;
}

function switchTab(tabId) {
  try {
    const tabKey = normalizeTabKey(tabId);
    if (!tabKey) return;

    // 1. Quản lý hiển thị Panels an toàn tuyệt đối
    const panels = document.querySelectorAll(".tab-content-panel");
    let targetPanel = document.getElementById(`panel-${tabKey}`);
    if (!targetPanel && tabKey === "premium") {
      targetPanel = document.getElementById("panel-premium-maintenance");
    }
    if (!targetPanel) {
      targetPanel = document.getElementById(tabKey) ||
                    document.getElementById(`tab-${tabKey}`) ||
                    document.querySelector(`[data-tab-panel="${tabKey}"]`);
    }
    if (!targetPanel && panels.length > 0) {
      targetPanel = panels[0];
    }

    panels.forEach(p => {
      const isTarget = (p === targetPanel);
      if (isTarget) {
        p.classList.add("active");
        p.style.setProperty("display", "block", "important");
        p.setAttribute("aria-hidden", "false");
      } else {
        p.classList.remove("active");
        p.style.setProperty("display", "none", "important");
        p.setAttribute("aria-hidden", "true");
      }
    });

    // 2. Quản lý Buttons (Cả Desktop Navbar lẫn Mobile Bottom Nav)
    const allBtns = document.querySelectorAll(".service-tab-btn, .mobile-bottom-nav-btn, [role='tab'][data-tab]");
    allBtns.forEach(btn => {
      if (btn.classList.contains("btn-video-tab") || btn.classList.contains("btn-tool-tab")) return;
      const rawTab = btn.dataset.tab || btn.getAttribute("data-tab") || "";
      const bTab = normalizeTabKey(rawTab);
      const isAct = (bTab === tabKey);
      btn.classList.toggle("active", isAct);
      btn.setAttribute("aria-selected", isAct ? "true" : "false");
    });

    // 3. Cập nhật URL (?tab=... và history state) mượt mà, không giật trang
    try {
      if (window.history && window.history.replaceState) {
        const u = new URL(window.location.href);
        u.searchParams.set("tab", tabKey);
        window.history.replaceState({ tab: tabKey }, "", u.toString());
      }
    } catch (e) {
      try {
        window.location.hash = tabKey;
      } catch (err) {}
    }

    // 4. Cuộn mượt lên đầu trang
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  } catch (err) {
    console.error("switchTab critical error:", err);
  }
}

// Gắn toàn cục ngay lập tức vào window để hỗ trợ cả inline HTML onclick
window.switchTab = switchTab;

function initTabs() {
  try {
    const tabBtns = document.querySelectorAll(".service-tab-btn, .mobile-bottom-nav-btn, [role='tab'][data-tab]");
    tabBtns.forEach(btn => {
      if (btn.classList.contains("btn-video-tab") || btn.classList.contains("btn-tool-tab")) return;
      btn.addEventListener("click", (e) => {
        try {
          e.preventDefault();
          const tabName = btn.dataset.tab || btn.getAttribute("data-tab");
          if (tabName) switchTab(tabName);
        } catch (err) {
          console.error("Tab click error:", err);
        }
      });
    });
  } catch (e) {
    console.error("initTabs error:", e);
  }
}

// Bổ sung Event Delegation toàn cục bảo vệ cấp 2 (Bulletproof Layer)
document.addEventListener("click", (e) => {
  try {
    const btn = e.target.closest(".service-tab-btn, .mobile-bottom-nav-btn, [data-tab]");
    if (btn && !btn.classList.contains("btn-video-tab") && !btn.classList.contains("btn-tool-tab")) {
      const tab = btn.dataset.tab || btn.getAttribute("data-tab");
      if (tab) {
        e.preventDefault();
        switchTab(tab);
      }
    }
  } catch (err) {}
});

// ==========================================
// INITIALIZATION BOOTSTRAP (Zero-Freeze & Fault-Tolerant)
// ==========================================
function bootstrapApp() {
  // 1. Khởi tạo Tabs & Routing trước tiên để UI luôn tương tác được
  try { initTabs(); } catch (e) { console.error("initTabs error:", e); }
  try { initUrlRouting(); } catch (e) { console.error("initUrlRouting error:", e); }

  // 2. Khởi tạo Banner
  try { checkInAppBrowser(); } catch (e) { console.error("checkInAppBrowser error:", e); }

  // 3. Khởi tạo các module dịch vụ độc lập (Lỗi module này không làm ảnh hưởng module khác)
  try { initChungSuc(); } catch (e) { console.error("initChungSuc error:", e); }
  try { initLocket(); } catch (e) { console.error("initLocket error:", e); }
  try { initMxh(); } catch (e) { console.error("initMxh error:", e); }
  try { initPremium(); } catch (e) { console.error("initPremium error:", e); }
  try { initLookup(); } catch (e) { console.error("initLookup error:", e); }
  try { initPaymentModal(); } catch (e) { console.error("initPaymentModal error:", e); }
  try { initLiveTicker(); } catch (e) { console.error("initLiveTicker error:", e); }
  try { checkAndRestorePendingOrder(); } catch (e) { console.error("checkAndRestorePendingOrder error:", e); }

  try { initVipTierCheckers(); } catch (e) { console.error("initVipTierCheckers error:", e); }
  try { initSmmSmartTools(); } catch (e) { console.error("initSmmSmartTools error:", e); }
  try { initFreeTools(); } catch (e) { console.error("initFreeTools error:", e); }
  try { checkAndShowAnnouncement(); } catch (e) { console.error("checkAndShowAnnouncement error:", e); }

  // 4. Kích hoạt đúng tab ban đầu dựa trên tham số URL hoặc trạng thái dịch vụ
  try {
    const params = new URLSearchParams(window.location.search);
    const rawReq = params.get("tab") || window.location.hash;
    const reqTab = rawReq ? normalizeTabKey(rawReq) : "";
    const se = window.gServicesEnabled || { chungsuc: true, locket: true, mxh: true, premium: true };
    const firstEnabledTab = se.chungsuc ? "chungsuc" : (se.locket ? "locket" : (se.mxh ? "mxh" : (se.premium ? "premium" : "lookup")));

    if (reqTab && ["chungsuc", "locket", "mxh", "premium", "lookup", "tools"].includes(reqTab)) {
      if (reqTab === "chungsuc" && !se.chungsuc) {
        switchTab(firstEnabledTab);
      } else if (reqTab === "locket" && !se.locket) {
        switchTab(firstEnabledTab);
      } else if (reqTab === "mxh" && !se.mxh) {
        switchTab(firstEnabledTab);
      } else if (reqTab === "premium" && !se.premium) {
        switchTab(firstEnabledTab);
      } else {
        switchTab(reqTab);
      }
    } else {
      if (!se.chungsuc) {
        switchTab(firstEnabledTab);
      } else {
        switchTab("chungsuc");
      }
    }
  } catch (e) {
    console.error("Initial tab resolution error:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapApp);
} else {
  bootstrapApp();
}

// ==========================================
// 1. CHUNG SỨC LIÊN QUÂN
// ==========================================
function initChungSuc() {
  const codeInput = document.getElementById("csCodeInput");
  const btnPaste = document.getElementById("btnPasteCS");
  const btnSubmit = document.getElementById("btnSubmitCS");
  if (!codeInput || !btnSubmit) return;

  // Load packages from API
  fetch("/api/chungsuc/packages")
    .then(r => r.json())
    .then(data => {
      if (data.success && data.packages) {
        gChungSucPackages = data.packages;
        renderCsPackages();
      }
    })
    .catch(err => console.error("Error loading CS packages:", err));

  // Auto clean code on input
  codeInput.addEventListener("input", () => {
    const raw = codeInput.value;
    const clean = extractInviteCode(raw);
    const badge = document.getElementById("csDetectedBadge");
    const badgeText = document.getElementById("csCleanCodeText");

    if (clean && clean.length >= 4) {
      badgeText.textContent = clean;
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  });

  // Paste from clipboard button
  if (btnPaste) {
    btnPaste.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          codeInput.value = text;
          codeInput.dispatchEvent(new Event("input"));
          showToast("Đã dán nội dung từ bộ nhớ tạm!", "success");
        }
      } catch (e) {
        codeInput.focus();
        showToast("Vui lòng nhấn giữ ô nhập để dán link.", "info");
      }
    });
  }

  // Custom pack qty counter
  const minusBtn = document.getElementById("btnCsMinus");
  const plusBtn = document.getElementById("btnCsPlus");
  const qtyInput = document.getElementById("csCustomQty");

  if (minusBtn && plusBtn && qtyInput) {
    minusBtn.addEventListener("click", () => {
      let val = parseInt(qtyInput.value) || 4;
      if (val > 4) {
        qtyInput.value = val - 1;
        updateCsSummary();
      }
    });
    plusBtn.addEventListener("click", () => {
      let val = parseInt(qtyInput.value) || 4;
      qtyInput.value = val + 1;
      updateCsSummary();
    });
    qtyInput.addEventListener("input", updateCsSummary);
  }

  // Submit Chung Sức Order
  btnSubmit.addEventListener("click", handleCsSubmit);
}

function extractInviteCode(text) {
  if (!text) return "";
  text = String(text).trim();
  const matchDash = text.match(/--\s*([A-Za-z0-9_-]+)\s*--/);
  if (matchDash) return matchDash[1].trim();

  if (text.includes("http")) {
    const matchUrl = text.match(/[?&](?:code|id|invite|c|token)=([A-Za-z0-9_-]+)/);
    if (matchUrl) return matchUrl[1].trim();
  }

  const cleaned = text.replace(/\[\[.*?\]\]/g, "").trim();
  const matchKw = cleaned.match(/(?:mã\s*mời|mã|code)[:\s\-]*([A-Za-z0-9_-]{4,30})/i);
  if (matchKw) return matchKw[1].trim();

  const matchPure = cleaned.match(/^([A-Za-z0-9_-]{4,35})$/);
  if (matchPure) return matchPure[1].trim();

  const tokens = cleaned.match(/[A-Za-z0-9_-]{6,30}/g);
  if (tokens && tokens.length > 0) return tokens[0].trim();

  return text.trim();
}

function renderCsPackages() {
  const container = document.getElementById("csPackagesList");
  if (!container) return;
  container.innerHTML = "";

  const orderKeys = ["full_3_ruong", "goi_1k2_sss", "goi_tuy_chon", "ruong_ss", "san_sss_700"];
  orderKeys.forEach(key => {
    const pkg = gChungSucPackages[key];
    if (!pkg) return;

    const card = document.createElement("div");
    card.className = `pkg-card cs-pkg-card ${key === gSelectedCsPkg ? "active" : ""}`;
    card.dataset.id = key;

    const badgeHtml = pkg.badge ? `<div class="pkg-badge">${pkg.badge}</div>` : "";
    const turnsHtml = pkg.turns ? `<div class="pkg-turns text-cyan">${pkg.turns} Lượt Buff</div>` : "";

    card.innerHTML = `
      ${badgeHtml}
      <div class="pkg-name">${pkg.name}</div>
      <div class="pkg-price">${pkg.price_formatted || (pkg.price ? pkg.price.toLocaleString("vi-VN") + "đ" : "")}</div>
      ${turnsHtml}
      <div class="pkg-desc">${pkg.desc || ""}</div>
      ${pkg.refund_policy ? `<div class="pkg-refund-note"><i class="fa-solid fa-shield"></i> ${pkg.refund_policy}</div>` : ""}
    `;

    card.addEventListener("click", () => {
      document.querySelectorAll(".cs-pkg-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      gSelectedCsPkg = key;

      const customBox = document.getElementById("csCustomPackBox");
      if (key === "goi_tuy_chon") {
        customBox.style.display = "block";
      } else {
        customBox.style.display = "none";
      }
      updateCsSummary();
    });

    container.appendChild(card);
  });

  updateCsSummary();
}

function updateCsSummary() {
  const pkg = gChungSucPackages[gSelectedCsPkg];
  if (!pkg) return;

  const summaryName = document.getElementById("csSummaryPkgName");
  const summaryTurns = document.getElementById("csSummaryTurns");
  const summaryTotal = document.getElementById("csSummaryTotal");

  if (gSelectedCsPkg === "goi_tuy_chon") {
    const qty = Math.max(4, parseInt(document.getElementById("csCustomQty").value) || 4);
    const pPerPack = pkg.price_per_pack || 2222;
    const tPerPack = pkg.turns_per_pack || 38;
    const totalTurns = qty * tPerPack;
    const totalAmount = qty * pPerPack;

    document.getElementById("csCustomTurns").textContent = totalTurns;
    summaryName.textContent = `Gói Tùy Chọn (${qty} gói)`;
    summaryTurns.textContent = `${totalTurns} Lượt`;
    summaryTotal.textContent = totalAmount.toLocaleString("vi-VN") + "đ";
  } else {
    summaryName.textContent = pkg.name;
    summaryTurns.textContent = `${pkg.turns} Lượt`;
    summaryTotal.textContent = pkg.price_formatted || (pkg.price.toLocaleString("vi-VN") + "đ");
  }
}

let isCsSubmitting = false;
async function handleCsSubmit() {
  if (isCsSubmitting) return;
  const codeInput = document.getElementById("csCodeInput");
  const zaloInput = document.getElementById("csZaloInput");
  const btn = document.getElementById("btnSubmitCS");

  const raw = codeInput.value.trim();
  const clean = extractInviteCode(raw);
  const zalo = zaloInput.value.trim();

  if (!clean || clean.length < 4) {
    showToast("Vui lòng nhập Link hoặc Mã mời Chung Sức Liên Quân!", "error");
    codeInput.focus();
    return;
  }
  if (!zalo || zalo.length < 9) {
    showToast("Vui lòng nhập số Zalo hợp lệ để nhận hỗ trợ và bảo hiểm!", "error");
    zaloInput.focus();
    return;
  }

  const payload = {
    code: clean,
    package_id: gSelectedCsPkg,
    zalo: zalo,
    custom_packs: gSelectedCsPkg === "goi_tuy_chon" ? (parseInt(document.getElementById("csCustomQty").value) || 4) : 0
  };

  isCsSubmitting = true;
  btn.disabled = true;
  btn.dataset.originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang khởi tạo đơn hàng...</span>`;

  const client_request_id = 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  payload.client_request_id = client_request_id;

  try {
    const { data } = await safeFetchJson("/api/chungsuc/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (data.success && data.order) {
      showToast("Khởi tạo đơn hàng thành công!", "success");
      saveRecentOrder(data.order);
      openPaymentModal(data.order);
    } else {
      showToast(data.msg || "Không thể tạo đơn hàng.", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || `<i class="fa-solid fa-bolt"></i> <span>Tạo Đơn & Thanh Toán Ngay</span>`;
    isCsSubmitting = false;
  }
}

// ==========================================
// 2. NÂNG CẤP LOCKET GOLD
// ==========================================
function initLocket() {
  const userInput = document.getElementById("locketUserInput");
  const checkBtn = document.getElementById("btnCheckLocketUser");
  const submitBtn = document.getElementById("btnSubmitLocket");
  if (!userInput || !checkBtn) return;

  // Auto clean Locket input on blur / paste / enter
  if (userInput) {
    const doClean = () => {
      const c = cleanLocketUser(userInput.value);
      if (c && c !== userInput.value) userInput.value = c;
    };
    userInput.addEventListener("blur", doClean);
    userInput.addEventListener("paste", (e) => {
      const paste = (e.clipboardData || window.clipboardData)?.getData("text");
      if (paste) {
        const c = cleanLocketUser(paste);
        if (c) {
          e.preventDefault();
          userInput.value = c;
        }
      }
    });
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        checkBtn.click();
      }
    });
  }

  // Package selector
  document.querySelectorAll(".locket-pkg-item").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".locket-pkg-item").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      gLocketSelectedPkg = card.dataset.pkg;
      updateLocketSummary();
    });
  });

  // Check Profile
  checkBtn.addEventListener("click", async () => {
    const val = userInput.value.trim();
    if (!val) {
      showToast("Vui lòng nhập Username hoặc Link Locket Profile!", "error");
      userInput.focus();
      return;
    }

    checkBtn.disabled = true;
    checkBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Kiểm tra...`;

    try {
      const { data } = await safeFetchJson("/api/locket/user-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: val })
      });

      if (data.success && data.user) {
        gLocketUser = data.user;
        renderLocketUserPreview(data.user);
        updateLocketSummary();
        const isPurchased = Boolean(data.alreadyPurchased || data.is_existing_customer || (data.user && (data.user.alreadyPurchased || data.user.is_existing_customer)));
        const orderCode = data.orderCode || data.existing_order_id || (data.user && (data.user.orderCode || data.user.existing_order_id));

        if (isPurchased && orderCode) {
          openExistingCustomerModal(data.user.username, orderCode);
        } else {
          try {
            localStorage.removeItem("dth_locket_purchased_" + String(val).toLowerCase());
            localStorage.removeItem("dth_locket_purchased_" + String(data.user.username).toLowerCase());
          } catch(e) {}
          showToast("Đã tìm thấy tài khoản Locket!", "success");
        }
      } else {
        showToast(data.msg || "Không tìm thấy người dùng Locket này.", "error");
      }
    } catch (e) {
      showToast("Lỗi kiểm tra Locket: " + e.message, "error");
    } finally {
      setTimeout(() => {
        checkBtn.disabled = false;
        checkBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Kiểm Tra`;
      }, 3000);
    }
  });

  // Submit Locket Order
  submitBtn.addEventListener("click", handleLocketSubmit);
}

function renderLocketUserPreview(user) {
  const box = document.getElementById("locketProfilePreview");
  const avatar = document.getElementById("locketAvatarImg");
  const dName = document.getElementById("locketDisplayName");
  const uText = document.getElementById("locketUsernameText");
  const uidText = document.getElementById("locketUidText");
  const badge = document.getElementById("locketStatusBadge");

  const defaultAvatar = "https://play-lh.googleusercontent.com/eRZLg00mAQGayCrFjDBklPIpW3qFHcmUs8PUQA4z7hVe-cDKMcRqecVHONAIexJGJZM";
  avatar.src = user.profile_picture_url || defaultAvatar;
  avatar.onerror = function() {
    this.src = defaultAvatar;
  };
  dName.textContent = user.display_name || user.username;
  uText.textContent = "@" + user.username;
  uidText.textContent = user.uid ? user.uid : "Không xác định";

  if (user.has_gold) {
    badge.className = "locket-badge gold";
    badge.innerHTML = '<i class="fa-solid fa-crown" style="color: #f59e0b;"></i> Đã có Gold (Nâng gia hạn / Giữ vĩnh viễn)';
  } else {
    badge.className = "locket-badge free";
    badge.innerHTML = '<i class="fa-solid fa-user-check" style="color: #3b82f6;"></i> Tài khoản Free (Chưa có Gold)';
  }

  box.style.display = "flex";
}

function updateLocketSummary() {
  const targetElem = document.getElementById("locketSummaryTarget");
  const pkgElem = document.getElementById("locketSummaryPkg");
  const totalElem = document.getElementById("locketSummaryTotal");

  if (gLocketUser) {
    targetElem.textContent = `@${gLocketUser.username} (${gLocketUser.display_name})`;
  } else {
    targetElem.textContent = "Chưa kiểm tra tài khoản";
  }

  if (gLocketSelectedPkg === "with_dns") {
    pkgElem.textContent = "Giữ Gold (Vĩnh Viễn) + DNS";
    totalElem.textContent = "30.000đ";
  } else {
    pkgElem.textContent = "Không Giữ Gold (1 Lần)";
    totalElem.textContent = "10.000đ";
  }
}


let gExistingCustomerData = null;

function openExistingCustomerModal(username, existingOrderId) {
  gExistingCustomerData = { username, existingOrderId };
  const modal = document.getElementById("modalExistingCustomerLocket");
  const userSpan = document.getElementById("existingCustUsername");
  const orderSpan = document.getElementById("existingCustOrderId");
  const orderWrap = document.getElementById("existingCustOrderIdWrapper");

  if (userSpan) userSpan.textContent = username;
  if (orderSpan) orderSpan.textContent = existingOrderId ? (existingOrderId.startsWith("#") ? existingOrderId : `#${existingOrderId}`) : "---";
  if (orderWrap) orderWrap.style.display = existingOrderId ? "block" : "none";
  if (modal) modal.style.display = "flex";

  const btnGo = document.getElementById("btnGoToLookupExisting");
  if (btnGo) {
    btnGo.onclick = function() {
      closeExistingCustomerModal();
      switchTab("lookup");
      const lookupInp = document.getElementById("lookupInput");
      if (lookupInp) {
        // Tự động gán mã đơn đó vào ô tìm kiếm tra cứu và kích hoạt tìm kiếm ngay lập tức
        lookupInp.value = existingOrderId || username;
        setTimeout(() => {
          performLookup();
        }, 150);
      }
    };
  }

  const btnForce = document.getElementById("btnForceBuyNewLocket");
  if (btnForce) {
    btnForce.onclick = function() {
      closeExistingCustomerModal();
      handleLocketSubmit(true);
    };
  }
}

function closeExistingCustomerModal() {
  const modal = document.getElementById("modalExistingCustomerLocket");
  if (modal) modal.style.display = "none";
}

let isLocketSubmitting = false;
async function handleLocketSubmit(forceNew = false) {
  if (typeof forceNew !== "boolean") forceNew = false;
  if (isLocketSubmitting) return;
  const userInput = document.getElementById("locketUserInput");
  const zaloInput = document.getElementById("locketZaloInput");
  const btn = document.getElementById("btnSubmitLocket");

  const val = userInput.value.trim();
  const zalo = zaloInput.value.trim();

  if (!val) {
    showToast("Vui lòng nhập Username hoặc Link Locket!", "error");
    userInput.focus();
    return;
  }
  if (!zalo || zalo.length < 9) {
    showToast("Vui lòng nhập số Zalo hợp lệ để nhận hỗ trợ cài đặt!", "error");
    zaloInput.focus();
    return;
  }

  const payload = {
    username: val,
    package_type: gLocketSelectedPkg,
    zalo: zalo,
    uid: gLocketUser ? gLocketUser.uid : "",
    avatar: gLocketUser ? gLocketUser.profile_picture_url : "",
    force_new: forceNew
  };

  isLocketSubmitting = true;
  btn.disabled = true;
  btn.dataset.originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang khởi tạo đơn hàng...</span>`;

  const client_request_id = 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  payload.client_request_id = client_request_id;

  try {
    const { data } = await safeFetchJson("/api/locket/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const isPurchased = Boolean(data.alreadyPurchased || data.is_existing_customer);
    const orderCode = data.orderCode || data.existing_order_id;
    if (isPurchased && orderCode) {
      openExistingCustomerModal(data.username || val, orderCode);
      return;
    }
    if (data.success && data.order) {
      showToast("Khởi tạo đơn hàng Locket Gold thành công!", "success");
      saveRecentOrder(data.order);
      openPaymentModal(data.order);
    } else {
      showToast(data.msg || "Không thể tạo đơn hàng.", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || `<i class="fa-solid fa-crown"></i> <span>Kích Hoạt Locket Gold Ngay</span>`;
    isLocketSubmitting = false;
  }
}

// ==========================================
// 3. MẠNG XÃ HỘI (DỊCH VỤ MXH)
// ==========================================
function initMxh() {
  const platformBtns = document.querySelectorAll("#mxhPlatformFilter .platform-pill");
  const actionBtns = document.querySelectorAll("#mxhActionFilter .action-pill");
  const catalogSelect = document.getElementById("mxhCatalogSelect");
  const qtyInput = document.getElementById("mxhQtyInput");
  const btnPaste = document.getElementById("btnPasteMXH");
  const btnSubmit = document.getElementById("btnSubmitMXH");

  // Load MXH services
  fetch("/api/mxh/services")
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        gMxhFeatured = data.featured || [];
        gMxhServices = data.services || [];
        populateMxhCatalogSelect();
      }
    })
    .catch(err => console.error("Error loading MXH services:", err));

  // Platform Filter Pills (Toàn bộ 8 Nền tảng)
  platformBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      platformBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      gMxhPlatform = btn.dataset.platform;

      // Tự động kiểm tra hành động: nếu nền tảng này không có loại đang chọn (vd: YouTube không có comment) -> tự bật Tất Cả
      const availActions = new Set(
        gMxhServices
          .filter(s => String(s.platform || "").toLowerCase() === String(gMxhPlatform).toLowerCase())
          .map(s => String(s.action || "").toLowerCase())
      );
      if (gMxhAction !== "all" && !availActions.has(gMxhAction)) {
        gMxhAction = "all";
        actionBtns.forEach(b => b.classList.toggle("active", b.dataset.action === "all"));
      }

      // Tự động kiểm tra nguồn gốc Việt/Tây
      const availOrigins = new Set(
        gMxhServices
          .filter(s => String(s.platform || "").toLowerCase() === String(gMxhPlatform).toLowerCase())
          .map(s => String(s.origin || "").toLowerCase())
      );
      if (gMxhOrigin !== "all" && !availOrigins.has(gMxhOrigin)) {
        gMxhOrigin = "all";
        const oBtns = document.querySelectorAll("#mxhOriginFilter .origin-pill");
        oBtns.forEach(b => b.classList.toggle("active", b.dataset.origin === "all"));
      }

      updateMxhFilterBadges();
      populateMxhCatalogSelect("");
    });
  });

  // Action Filter Pills (All, Like, Follow, View, Share, Comment)
  actionBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      actionBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      gMxhAction = btn.dataset.action;
      populateMxhCatalogSelect("");
    });
  });

  // Origin Filter Pills (All, Viet, Tay)
  const originBtns = document.querySelectorAll("#mxhOriginFilter .origin-pill");
  originBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      originBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      gMxhOrigin = btn.dataset.origin;
      populateMxhCatalogSelect("");
    });
  });

  // Catalog Select
  if (catalogSelect) {
    catalogSelect.addEventListener("change", () => {
      const s = gMxhServices.find(x => String(x.service_id) === String(catalogSelect.value));
      if (s) selectMxhService(s);
    });
  }



  // Qty change
  if (qtyInput) {
    qtyInput.addEventListener("input", updateMxhSummary);
  }

  // Comments textarea input: count non-empty lines and auto sync qty
  const cmtInput = document.getElementById("mxhCommentsInput");
  if (cmtInput) {
    cmtInput.addEventListener("input", () => {
      const lines = cmtInput.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      const count = lines.length;
      const countElem = document.getElementById("mxhCommentCount");
      if (countElem) countElem.textContent = count;
      if (isCommentService(gMxhSelectedService)) {
        if (qtyInput) {
          qtyInput.value = count;
        }
        updateMxhSummary();
      }
    });
  }

  // Paste Link
  if (btnPaste) {
    btnPaste.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          document.getElementById("mxhLinkInput").value = text;
          showToast("Đã dán link vào ô nhập!", "success");
        }
      } catch (e) {
        document.getElementById("mxhLinkInput").focus();
      }
    });
  }

  // Submit MXH Order
  if (btnSubmit) {
    btnSubmit.addEventListener("click", handleMxhSubmit);
  }
}

function updateMxhFilterBadges() {
  const currentPlat = String(gMxhPlatform || "tiktok").toLowerCase();
  const servicesInPlat = gMxhServices.filter(s => String(s.platform || "").toLowerCase() === currentPlat);

  const actionBtns = document.querySelectorAll("#mxhActionFilter .action-pill");
  actionBtns.forEach(btn => {
    const act = btn.dataset.action;
    if (act === "all") {
      btn.style.opacity = "1";
    } else {
      const cnt = servicesInPlat.filter(s => String(s.action || "").toLowerCase() === act).length;
      btn.style.opacity = (cnt === 0) ? "0.35" : "1";
    }
  });

  const originBtns = document.querySelectorAll("#mxhOriginFilter .origin-pill");
  originBtns.forEach(btn => {
    const orig = btn.dataset.origin;
    if (orig === "all") {
      btn.style.opacity = "1";
    } else {
      const cnt = servicesInPlat.filter(s => String(s.origin || "").toLowerCase() === orig).length;
      btn.style.opacity = (cnt === 0) ? "0.35" : "1";
    }
  });
}

function populateMxhCatalogSelect(searchTerm = "") {
  const select = document.getElementById("mxhCatalogSelect");
  if (!select) return;

  select.innerHTML = '<option value="">-- Chọn dịch vụ cần tăng --</option>';

  const filtered = gMxhServices.filter(s => {
    // 1. Filter Platform (Strict exact match - ABSOLUTELY ZERO cross-platform leakage)
    const targetPlat = String(gMxhPlatform || "tiktok").toLowerCase();
    const sPlat = String(s.platform || "").toLowerCase();
    if (sPlat !== targetPlat) {
      return false;
    }

    // 2. Filter Action (tim/like, follow, view, share, comment)
    if (gMxhAction && gMxhAction !== "all") {
      const targetAct = String(gMxhAction).toLowerCase();
      const sAct = String(s.action || "").toLowerCase();
      if (targetAct === "like") {
        if (sAct !== "like") return false;
      } else if (targetAct === "follow") {
        if (sAct !== "follow" && sAct !== "sub") return false;
      } else if (targetAct === "view") {
        if (sAct !== "view") return false;
      } else if (targetAct === "share") {
        if (sAct !== "share") return false;
      } else if (targetAct === "comment") {
        if (sAct !== "comment") return false;
      }
    }

    // 3. Filter Origin (Lọc Việt và Tây)
    if (gMxhOrigin && gMxhOrigin !== "all") {
      let sOrig = String(s.origin || "").toLowerCase();
      if (!sOrig) {
        const full = (String(s.name || "") + " " + String(s.category || "") + " " + String(s.description || "")).toLowerCase();
        sOrig = (full.includes("việt") || full.includes("viet")) ? "viet" : "tay";
      }
      if (sOrig !== gMxhOrigin) return false;
    }

    // 4. Search query (fallback if any)
    if (!searchTerm) return true;
    return String(s.name).toLowerCase().includes(searchTerm) || String(s.category || "").toLowerCase().includes(searchTerm);
  });

  // 4. SORT BY CHEAPEST PRICE FIRST (Xếp giá rẻ lên đầu)
  filtered.sort((a, b) => {
    const pA = (a.sale_price !== undefined ? a.sale_price : a.price_per_unit) || 0.05;
    const pB = (b.sale_price !== undefined ? b.sale_price : b.price_per_unit) || 0.05;
    return pA - pB;
  });

  // Tự động fallback: nếu bộ lọc làm rỗng danh sách -> reset Action & Origin về 'Tất cả' để khách LUÔN THẤY DỊCH VỤ!
  if (filtered.length === 0 && (gMxhAction !== "all" || gMxhOrigin !== "all")) {
    gMxhAction = "all";
    gMxhOrigin = "all";
    document.querySelectorAll("#mxhActionFilter .action-pill").forEach(b => b.classList.toggle("active", b.dataset.action === "all"));
    document.querySelectorAll("#mxhOriginFilter .origin-pill").forEach(b => b.classList.toggle("active", b.dataset.origin === "all"));
    updateMxhFilterBadges();
    return populateMxhCatalogSelect(searchTerm);
  }

  if (filtered.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = `-- Nền tảng này đang cập nhật thêm dịch vụ mới --`;
    select.appendChild(opt);
    select.value = "";
    gMxhSelectedService = null;
    return;
  }

  filtered.forEach((s, idx) => {
    const opt = document.createElement("option");
    opt.value = s.service_id;
    const unitP = (s.sale_price !== undefined ? s.sale_price : s.price_per_unit) || 0.05;
    const per1k = Math.round(unitP * 1000);
    const badgeText = idx === 0 ? "🔥 RẺ NHẤT: " : "";
    opt.textContent = `${badgeText}[${unitP}đ/lượt] ${s.name}`;
    select.appendChild(opt);
  });

  // Auto select cheapest match
  if (filtered.length > 0) {
    select.value = filtered[0].service_id;
    selectMxhService(filtered[0]);
  }
}

function selectMxhService(service) {
  gMxhSelectedService = service;
  const detailBox = document.getElementById("mxhServiceDetailBox");
  const descElem = document.getElementById("mxhServiceDesc");
  const minElem = document.getElementById("mxhMinQty");
  const maxElem = document.getElementById("mxhMaxQty");
  const unitElem = document.getElementById("mxhUnitPrice");
  const qtyInput = document.getElementById("mxhQtyInput");
  const qtyHint = document.getElementById("mxhQtyHint");

  const minQ = service.min || service.min_qty || 1000;
  const maxQ = service.max || service.max_qty || 1000000;
  const effectivePrice = (service.sale_price !== undefined ? service.sale_price : (service.price_per_unit || service.unit_price || 0.05));

  minElem.textContent = minQ.toLocaleString("vi-VN");
  maxElem.textContent = maxQ.toLocaleString("vi-VN");
  unitElem.textContent = `${effectivePrice}đ`;
  qtyHint.textContent = `Tối thiểu: ${minQ.toLocaleString("vi-VN")}, Tối đa: ${maxQ.toLocaleString("vi-VN")}`;

  qtyInput.min = minQ;
  qtyInput.max = maxQ;

  const isCmt = isCommentService(service);
  const cmtGroup = document.getElementById("mxhCommentGroup");
  const cmtInput = document.getElementById("mxhCommentsInput");

  if (isCmt) {
    if (cmtGroup) cmtGroup.style.display = "block";
    qtyInput.readOnly = true;
    qtyInput.style.background = "#f1f5f9";
    qtyInput.style.cursor = "not-allowed";
    const curLines = cmtInput ? cmtInput.value.split("\n").map(l => l.trim()).filter(l => l.length > 0) : [];
    const count = curLines.length;
    document.getElementById("mxhCommentCount").textContent = count;
    qtyInput.value = count > 0 ? count : (service.default_qty || minQ || 10);
    qtyHint.textContent = `Tối thiểu: ${minQ.toLocaleString("vi-VN")}, Tối đa: ${maxQ.toLocaleString("vi-VN")} (Tự động tính theo số dòng)`;
  } else {
    if (cmtGroup) cmtGroup.style.display = "none";
    qtyInput.readOnly = false;
    qtyInput.style.background = "#ffffff";
    qtyInput.style.cursor = "text";
    if (!qtyInput.value || parseInt(qtyInput.value) < minQ) {
      qtyInput.value = service.default_qty || minQ;
    }
    qtyHint.textContent = `Tối thiểu: ${minQ.toLocaleString("vi-VN")}, Tối đa: ${maxQ.toLocaleString("vi-VN")}`;
  }

  if (service.description) {
    let cleanDesc = (service.description || "")
      .replace(/color\s*:\s*(#ffffff|#fff|white|#f8fafc|#f1f5f9|#e2e8f0|#cbd5e1)/gi, "color: #1e293b")
      .replace(/<b([^>]*)>/gi, '<b$1 style="color: #0f172a !important; font-weight: 700;">');
    descElem.innerHTML = cleanDesc;
    detailBox.style.display = "block";
  } else {
    detailBox.style.display = "none";
  }

  updateMxhSummary();
}

function updateMxhSummary() {
  if (!gMxhSelectedService) return;

  const summaryName = document.getElementById("mxhSummaryName");
  const summaryQty = document.getElementById("mxhSummaryQty");
  const baseAmountElem = document.getElementById("mxhSummaryBaseAmount");
  const discountRow = document.getElementById("mxhSaleDiscountRow");
  const discountElem = document.getElementById("mxhSummaryDiscount");
  const summaryTotal = document.getElementById("mxhSummaryTotal");

  const qty = parseInt(document.getElementById("mxhQtyInput").value) || 0;
  const baseRate = parseFloat(gMxhSelectedService.price_per_unit || gMxhSelectedService.unit_price || 0.05);
  const baseTotal = Math.round(qty * baseRate);
  let finalAmount = baseTotal;

  if (baseAmountElem) {
    baseAmountElem.textContent = baseTotal.toLocaleString("vi-VN") + "đ";
  }

  if (gMxhSelectedService.has_sale && gMxhSelectedService.sale_price) {
    const saleRate = parseFloat(gMxhSelectedService.sale_price);
    finalAmount = Math.round(qty * saleRate);
    const saved = baseTotal - finalAmount;
    if (saved > 0 && discountRow && discountElem) {
      discountRow.style.display = "flex";
      discountElem.textContent = `-${saved.toLocaleString("vi-VN")}đ`;
    } else if (discountRow) {
      discountRow.style.display = "none";
    }
  } else if (discountRow) {
    discountRow.style.display = "none";
  }

  finalAmount = Math.max(2000, finalAmount);
  summaryName.textContent = gMxhSelectedService.name;
  summaryQty.textContent = qty.toLocaleString("vi-VN");
  summaryTotal.textContent = finalAmount.toLocaleString("vi-VN") + "đ";
}

let isMxhSubmitting = false;
async function handleMxhSubmit() {
  if (isMxhSubmitting) return;
  if (!gMxhSelectedService) {
    showToast("Vui lòng chọn dịch vụ mạng xã hội!", "error");
    return;
  }

  const linkInput = document.getElementById("mxhLinkInput");
  const qtyInput = document.getElementById("mxhQtyInput");
  const zaloInput = document.getElementById("mxhZaloInput");
  const btn = document.getElementById("btnSubmitMXH");

  const link = linkInput.value.trim();
  const qty = parseInt(qtyInput.value) || 0;
  const zalo = zaloInput.value.trim();

  const minQ = gMxhSelectedService.min || gMxhSelectedService.min_qty || 10;
  const maxQ = gMxhSelectedService.max || gMxhSelectedService.max_qty || 10000000;

  if (!link) {
    showToast("Vui lòng nhập Link hoặc Tên người dùng!", "error");
    linkInput.focus();
    return;
  }
  if (qty < minQ || qty > maxQ) {
    showToast(`Số lượng phải từ ${minQ.toLocaleString("vi-VN")} đến ${maxQ.toLocaleString("vi-VN")}`, "error");
    qtyInput.focus();
    return;
  }
  if (!zalo || zalo.length < 9) {
    showToast("Vui lòng nhập số Zalo để theo dõi đơn!", "error");
    zaloInput.focus();
    return;
  }

  let commentsStr = "";
  if (isCommentService(gMxhSelectedService)) {
    const cmtInput = document.getElementById("mxhCommentsInput");
    const lines = cmtInput ? cmtInput.value.split("\n").map(l => l.trim()).filter(l => l.length > 0) : [];
    if (lines.length === 0) {
      showToast("Vui lòng nhập nội dung bình luận (mỗi dòng 1 bình luận)!", "error");
      cmtInput.focus();
      return;
    }
    commentsStr = lines.join("\n");
  }

  const payload = {
    service_id: gMxhSelectedService.service_id,
    link: link,
    quantity: qty,
    zalo: zalo,
    comments: commentsStr
  };

  isMxhSubmitting = true;
  btn.disabled = true;
  btn.dataset.originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang khởi tạo đơn hàng...</span>`;

  const client_request_id = 'REQ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  payload.client_request_id = client_request_id;

  try {
    const { data } = await safeFetchJson("/api/mxh/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (data.success && data.order) {
      showToast("Khởi tạo đơn hàng MXH thành công!", "success");
      saveRecentOrder(data.order);
      openPaymentModal(data.order);
    } else {
      showToast(data.msg || "Không thể tạo đơn hàng.", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || `<i class="fa-solid fa-cart-shopping"></i> <span>Tạo Đơn Tương Tác Ngay</span>`;
    isMxhSubmitting = false;
  }
}

// ==========================================
// 4. ORDER LOOKUP
// ==========================================
function initLookup() {
  const input = document.getElementById("lookupInput");
  const btn = document.getElementById("btnLookup");
  const trackBtn = document.getElementById("btnTrackOrder");
  if (!input || !btn) return;

  btn.addEventListener("click", performLookup);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") performLookup();
  });
  if (trackBtn) {
    trackBtn.addEventListener("click", () => {
      const s = document.getElementById("order-tracking-status") || document.getElementById("orderTrackingStatus");
      if (s) s.style.display = "block";
      enableOrderTracking();
    });
  }
  input.addEventListener("input", () => {
    if (input.value.trim() === "") renderRecentOrdersSuggestion();
  });
  try { restoreOrderTracking(); } catch (e) {}
  try { renderRecentOrdersSuggestion(); } catch (e) {}
}

async function performLookup() {
  const input = document.getElementById("lookupInput");
  const container = document.getElementById("lookupResultsContainer");
  const q = input.value.trim();
  const trackWrap = document.getElementById("orderTrackingWrapper");
  if (trackWrap) trackWrap.style.display = "block";
  const s = document.getElementById("order-tracking-status") || document.getElementById("orderTrackingStatus");
  if (s) s.style.display = "block";

  if (!q) {
    showToast("Vui lòng nhập Mã đơn hàng hoặc Số Zalo!", "error");
    input.focus();
    return;
  }

  container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Đang tìm kiếm đơn hàng...</p></div>`;

  try {
    const res = await fetch(`/api/order/lookup?query=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (data.success && data.orders && data.orders.length > 0) {
      renderLookupResults(data.orders);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-circle-xmark text-pink"></i>
          <p>Không tìm thấy đơn hàng nào khớp với "<strong></strong>". Hãy kiểm tra lại mã đơn hoặc số Zalo nhé!</p>
        </div>
      `;
      container.querySelector("strong").textContent = q;
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-pink">Lỗi tìm kiếm: <span></span></p></div>`;
    container.querySelector("span").textContent = e.message;
  }
}

async function enableOrderTracking() {
  const input = document.getElementById("lookupInput");
  const orderId = input.value.trim().toUpperCase();
  if (!/^(CS|LK|TT|PR)[A-Z0-9]{4,12}$/.test(orderId)) {
    showToast("Vui lòng nhập chính xác mã đơn hàng để bật theo dõi.", "error");
    input.focus();
    return;
  }

  try {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    const orders = await fetchOrdersForTracking(orderId);
    if (!orders) {
      showToast("Không tìm thấy đơn hàng với mã này.", "error");
      return;
    }

    startOrderTracking(orderId, orders.status || "PENDING");
    renderLookupResults([orders]);
    showToast("Đã bật theo dõi đơn hàng. Trang cần mở để kiểm tra cập nhật.", "success");
  } catch (e) {
    showToast("Không thể bật theo dõi: " + e.message, "error");
  }
}

function restoreOrderTracking() {
  try {
    const saved = JSON.parse(localStorage.getItem("dthTrackedOrder") || "null");
    if (!saved || typeof saved.orderId !== "string") return;
    if (!/^(CS|LK|TT|PR)[A-Z0-9]{4,12}$/.test(saved.orderId)) return;

    document.getElementById("lookupInput").value = saved.orderId;
    startOrderTracking(saved.orderId, saved.status || "");
    pollTrackedOrder();
  } catch (e) {
    console.error("Could not restore order tracking:", e);
  }
}

function startOrderTracking(orderId, status) {
  if (gOrderTrackingTimer) clearInterval(gOrderTrackingTimer);
  gTrackedOrderId = orderId;
  gTrackedOrderStatus = status;
  gTrackingRequestInFlight = false;
  persistTrackedOrder();
  updateOrderTrackingStatus();
  gOrderTrackingTimer = setInterval(() => {
    if (!document.hidden) {
      pollTrackedOrder();
    }
  }, 45000);
}

async function fetchOrdersForTracking(orderId) {
  const res = await fetch(`/api/order/lookup?query=${encodeURIComponent(orderId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || "Lỗi tra cứu đơn hàng.");
  if (!data.success || !Array.isArray(data.orders)) return null;
  return data.orders.find(order => String(order.order_id).toUpperCase() === orderId) || null;
}

async function pollTrackedOrder() {
  if (!gTrackedOrderId || gTrackingRequestInFlight) return;
  gTrackingRequestInFlight = true;
  try {
    const order = await fetchOrdersForTracking(gTrackedOrderId);
    if (!order) return;

    const currentStatus = order.status || "PENDING";
    if (gTrackedOrderStatus && currentStatus !== gTrackedOrderStatus) {
      const message = `Đơn ${gTrackedOrderId}: ${currentStatus}`;
      showToast(message, "info");
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("DTH Portal - Cập nhật đơn hàng", {
            body: message,
            tag: `dth-order-${gTrackedOrderId}`
          });
        } catch (e) {
          console.error("Could not display order notification:", e);
        }
      }
      renderLookupResults([order]);
    }

    gTrackedOrderStatus = currentStatus;
    persistTrackedOrder();
    updateOrderTrackingStatus();
    if (["COMPLETED", "CANCELED", "CANCELLED", "FAILED"].includes(currentStatus)) {
      clearInterval(gOrderTrackingTimer);
      gOrderTrackingTimer = null;
      try {
        localStorage.removeItem("dthTrackedOrder");
      } catch (e) {
        console.error("Could not clear finished order tracking:", e);
      }
      gTrackedOrderId = "";
      updateOrderTrackingStatus();
    }
  } catch (e) {
    console.error("Order tracking check failed:", e);
  } finally {
    gTrackingRequestInFlight = false;
  }
}

function persistTrackedOrder() {
  try {
    localStorage.setItem("dthTrackedOrder", JSON.stringify({
      orderId: gTrackedOrderId,
      status: gTrackedOrderStatus
    }));
  } catch (e) {
    console.error("Could not save order tracking:", e);
  }
}

function updateOrderTrackingStatus() {
  const statusElem = document.getElementById("order-tracking-status") || document.getElementById("orderTrackingStatus");
  const trackBtn = document.getElementById("btnTrackOrder");
  if (!statusElem || !trackBtn) return;

  if (!gTrackedOrderId) {
    statusElem.textContent = "Nhập mã đơn và bật theo dõi; cần giữ trang này mở để nhận cập nhật.";
    trackBtn.innerHTML = `<i class="fa-regular fa-bell"></i> Theo Dõi Đơn & Bật Thông Báo`;
    return;
  }

  const notificationStatus = "Notification" in window && Notification.permission === "granted"
    ? "Thông báo trình duyệt đã bật."
    : "Thông báo trình duyệt chưa được cấp quyền; vẫn có cập nhật trên trang.";
  statusElem.textContent = `Đang theo dõi ${gTrackedOrderId} • Trạng thái: ${gTrackedOrderStatus || "đang tải"}. Kiểm tra mỗi 30 giây khi trang mở. ${notificationStatus}`;
  trackBtn.innerHTML = `<i class="fa-solid fa-bell"></i> Đang Theo Dõi ${gTrackedOrderId}`;
}

function runOrderLookup(orderId) {
  const input = document.getElementById("lookupInput");
  input.value = orderId;
  performLookup();
}

async function customerReupGold(username, orderId) {
  if (!confirm(`Xác nhận yêu cầu KÍCH HOẠT LẠI GOLD VIP cho tài khoản @${username}?`)) return;
  showToast(`Đang gửi yêu cầu kích hoạt lại Gold cho @${username}...`, "info");
  try {
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username,
        order_id: orderId,
        package_type: "with_dns"
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Đã kích hoạt lại Gold thành công cho @${username}!`, "success");
      setTimeout(() => performLookup(), 1200);
    } else {
      showToast(data.msg || "Không thể kích hoạt lại Gold.", "error");
    }
  } catch (e) {
    showToast("Lỗi kết nối: " + e.message, "error");
  }
}

function renderLookupResults(orders) {
  const container = document.getElementById("lookupResultsContainer");
  container.innerHTML = "";

  orders.forEach(o => {
    const card = document.createElement("div");
    card.className = "lookup-order-card";

    let statusHtml = "";
    const st = o.status || "PENDING";
    const isLocket = o.service_type === "locket" || (o.order_id && o.order_id.startsWith("LK")) || o.package_type === "with_dns" || (o.package_name && o.package_name.toLowerCase().includes("gold"));
    const isPremium = o.service_type === "premium" || (o.order_id && o.order_id.startsWith("PR"));

    if (o.needs_customer_update) {
      statusHtml = `<span class="status-pill failed" style="background:#fff7ed;color:#ea580c;border:1.5px solid #fdba74;font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> Cần Đổi ${o.customer_update_type === 'code' ? 'Mã' : 'Link'} Mới</span>`;
    } else if (st === "COMPLETED") {
      statusHtml = `<span class="status-pill completed"><i class="fa-solid fa-circle-check"></i> Hoàn Thành</span>`;
    } else if (st === "PROCESSING" || st === "PAID") {
      statusHtml = `<span class="status-pill processing"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Đang Xử Lý</span>`;
    } else if (st === "PENDING") {
      statusHtml = `<span class="status-pill pending"><i class="fa-solid fa-clock"></i> Chờ Thanh Toán</span>`;
    } else {
      statusHtml = `<span class="status-pill failed"><i class="fa-solid fa-circle-exclamation"></i> Thất Bại</span>`;
    }

    const payBtnHtml = (st === "PENDING") ? `
      <button type="button" class="btn-primary-gradient" style="padding: 8px 18px; font-size: 0.88rem; width: auto;" onclick="openPaymentModal(${JSON.stringify(o).replace(/"/g, '&quot;')})">
        <i class="fa-solid fa-qrcode"></i> Thanh Toán Ngay
      </button>
    ` : "";

    // VIP Delivery box for Premium
    let vipPremiumHtml = "";
    if (st === "COMPLETED" && isPremium) {
      const plat = (o.platform || "").toLowerCase();
      let guideStep = "";
      if (plat === "youtube") {
        guideStep = "Mở hòm thư <strong>Gmail</strong> của bạn ➔ Tìm email từ Google Family / YouTube ➔ Bấm <strong>Chấp nhận lời mời</strong> là YouTube Premium được kích hoạt thành công!";
      } else if (plat === "spotify") {
        guideStep = "Kiểm tra hòm thư email để chấp nhận lời mời Family hoặc đăng nhập vào app Spotify để tận hưởng trọn vẹn chất lượng âm thanh 320kbps không quảng cáo!";
      } else {
        guideStep = "Mở app <strong>Netflix</strong> trên TV, Điện thoại hoặc Web ➔ Đăng nhập bằng thông tin tài khoản bên dưới, chọn đúng Profile và nhập Mã PIN riêng của bạn để xem phim 4K UHD!";
      }

      const deliveryBox = o.delivery_info ? `
        <div style="margin-top: 10px; background: #ffffff; border: 1.5px solid #fed7aa; border-radius: 10px; padding: 12px 14px;">
          <div style="font-weight: 800; font-size: 0.88rem; color: #9a3412; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
            <span><i class="fa-solid fa-key text-gold"></i> THÔNG TIN BÀN GIAO TÀI KHOẢN:</span>
            <button type="button" class="btn-copy" onclick="copyToClipboard('${o.delivery_info.replace(/'/g, "\\'")}', 'Đã sao chép thông tin tài khoản!')"><i class="fa-regular fa-copy"></i> Sao chép</button>
          </div>
          <div style="font-family: monospace; font-size: 0.9rem; color: #0f172a; white-space: pre-wrap; word-break: break-all; background: #fffbeb; padding: 10px; border-radius: 6px;">${o.delivery_info}</div>
        </div>
      ` : `
        <div style="margin-top: 10px; padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 0.85rem; color: #166534;">
          <i class="fa-solid fa-circle-check text-green"></i> Đơn hàng đã được Admin phê duyệt & hoàn tất! Vui lòng thực hiện theo hướng dẫn bên dưới.
        </div>
      `;

      vipPremiumHtml = `
        <div class="vip-premium-box">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
            <div style="font-weight: 800; font-size: 0.95rem; color: #b45309; display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-crown text-gold"></i> BÀN GIAO BẢN QUYỀN ${o.platform_name || "PREMIUM"}
            </div>
            <span style="font-size: 0.75rem; background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 3px 10px; border-radius: 20px; font-weight: 700;">
              <i class="fa-solid fa-circle-check"></i> ĐÃ HOÀN TẤT
            </span>
          </div>
          ${deliveryBox}
          <div style="margin-top: 10px; font-size: 0.84rem; color: #78350f; line-height: 1.5; background: rgba(254, 243, 199, 0.6); padding: 10px 12px; border-radius: 8px;">
            <strong><i class="fa-solid fa-lightbulb text-gold"></i> Hướng dẫn kích hoạt:</strong> ${guideStep}
          </div>
          <div style="margin-top: 10px;">
            <a href="https://zalo.me/0899195660" target="_blank" style="background: #0284c7; color: #fff; text-decoration: none; padding: 8px 14px; font-size: 0.82rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-weight: 700;">
              <i class="fa-solid fa-headset"></i> Cần Hỗ Trợ Kích Hoạt Qua Zalo
            </a>
          </div>
        </div>
      `;
    }

    // VIP Download box: ONLY WHEN COMPLETED AND IS LOCKET ORDER
    let vipDownloadHtml = "";
    if (st === "COMPLETED" && isLocket) {
      const cleanUser = (o.username || "").replace(/[^a-zA-Z0-9_.-]/g, "") || "VIP";
      const moduleUrl = o.module_link || "";
      const shadowScheme = `shadowrocket://install?module=${encodeURIComponent(moduleUrl)}`;
      vipDownloadHtml = `
        <div class="vip-gold-box">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div style="font-weight: 800; font-size: 0.95rem; color: #1e40af; display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-crown text-blue"></i> CẤU HÌNH & MODULE SHADOWROCKET GIỮ GOLD VIP (iOS)
            </div>
            <span style="font-size: 0.75rem; background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 3px 10px; border-radius: 20px; font-weight: 700;">
              <i class="fa-solid fa-circle-check"></i> ĐÃ KÍCH HOẠT
            </span>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-sub); margin-bottom: 12px; line-height: 1.5;">
            Đơn hàng Locket Gold đã kích hoạt thành công! Cài đặt ngay Module Shadowrocket All-in-One độc quyền (dth.sgmodule) để mở khóa Gold vĩnh viễn, video dài 60s và khung Widget VIP:
          </p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <a href="${shadowScheme}" class="vip-dl-btn btn-vip-module" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #fff;">
              <span style="display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-bolt text-warning" style="font-size: 1.25rem;"></i>
                <span>Cài Trực Tiếp Vào Shadowrocket (Module dth.sgmodule)</span>
              </span>
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>

            <button type="button" class="vip-dl-btn btn-vip-copy" onclick="copyToClipboard('${moduleUrl}', 'Đã sao chép link module Shadowrocket!')" style="background: linear-gradient(135deg, #059669 0%, #047857 100%) !important; color: #ffffff !important; border: none !important; cursor: pointer; box-shadow: 0 4px 14px rgba(5, 150, 105, 0.35) !important;">
              <span style="display: flex; align-items: center; gap: 10px; color: #ffffff !important;">
                <i class="fa-regular fa-copy" style="font-size: 1.25rem; color: #ffffff !important;"></i>
                <span style="color: #ffffff !important; font-weight: 700;">Sao Chép Link Module: <strong style="color: #a7f3d0 !important;">dth.sgmodule</strong></span>
              </span>
              <i class="fa-solid fa-clone" style="color: #a7f3d0 !important;"></i>
            </button>

            <button type="button" class="vip-dl-btn btn-vip-reup" onclick="customerReupGold('${cleanUser}', '${o.order_id}')" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important; color: #ffffff !important; border: none !important; cursor: pointer; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35) !important;">
              <span style="display: flex; align-items: center; gap: 10px; color: #ffffff !important;">
                <i class="fa-solid fa-rotate-right" style="color: #ffffff !important; font-size: 1.15rem;"></i>
                <span style="color: #ffffff !important; font-weight: 700;">Lên Lại / Kích Hoạt Lại Gold (Khách Cũ)</span>
              </span>
              <i class="fa-solid fa-crown" style="color: #fef08a !important;"></i>
            </button>

            <a href="/download-config?u=${encodeURIComponent(cleanUser)}" class="vip-dl-btn btn-vip-gold">
              <span style="display: flex; align-items: center; gap: 10px;">
                <i class="fa-brands fa-apple" style="font-size: 1.3rem;"></i>
                <span>Tải File DNS Profile: LocketGold_${cleanUser}.mobileconfig</span>
              </span>
              <i class="fa-solid fa-arrow-down"></i>
            </a>

            <button type="button" class="btn-vip-video" onclick="openVideoGuideModal('${o.order_id}', '${o.token || o.video_token || ''}')">
              <i class="fa-solid fa-circle-play text-blue"></i> Xem Video Hướng Dẫn Cài Shadowrocket & DNS (30 Giây)
            </button>

            <div style="margin-top: 10px; text-align: center; padding: 10px 14px; background: rgba(254, 240, 138, 0.25); border-radius: 8px; border: 1px dashed #f59e0b;">
              <a href="https://locket.cam/dth206" target="_blank" rel="noopener noreferrer" style="color: #b45309; font-weight: 700; text-decoration: none; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-heart" style="color: #ff3366; animation: heartbeat 1.5s infinite; display: inline-block;"></i>
                <span>💛 Nhấn vào đây để kết bạn Locket cùng chủ shop nha: <strong>locket.cam/dth206</strong></span>
              </a>
            </div>
          </div>
        </div>
      `;
    }

    // Progress Bar & Counter (Đã tăng / Còn lại / Gốc / Hiện tại)
    let progressHtml = "";
    const isMxh = ((o.service_type === "mxh") || (o.order_id && o.order_id.startsWith("TT")) || Boolean(o.delivered || o.quantity) || Boolean(o.link)) && !isPremium && !isLocket;
    const qty = Number(o.quantity || o.turns || 0);
    const delivered = Number(o.delivered || 0);
    const remains = Number(o.remains != null ? o.remains : Math.max(0, qty - delivered));
    const startCount = o.start_count != null ? Number(o.start_count) : null;
    const currentCount = startCount != null ? (startCount + delivered) : null;
    const progressPct = Math.min(100, Math.max(0, o.progress != null ? Number(o.progress) : (qty ? Math.round(delivered * 100 / qty) : (st === "COMPLETED" ? 100 : 0))));

    if (isMxh || qty > 0) {
      const barColor = (st === "COMPLETED") ? "#10b981" : "#007BFF";
      const refreshBtn = (st === "PROCESSING" || st === "PAID") ? `
        <button type="button" onclick="runOrderLookup('${o.order_id}')" style="background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;padding:3px 8px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:700;">
          <i class="fa-solid fa-arrows-rotate"></i> Cập nhật
        </button>
      ` : "";

      progressHtml = `
        <div class="lookup-progress-box" style="margin-top: 14px; padding: 14px; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
            <span style="font-weight: 800; font-size: 0.9rem; color: #0f172a; display: flex; align-items: center; gap: 7px;">
              <i class="fa-solid fa-chart-line" style="color: ${barColor}"></i> Tiến độ buff thực tế:
            </span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 800; font-size: 0.95rem; color: ${barColor};">
                ${progressPct}% (Đã tăng: +${delivered.toLocaleString('vi-VN')} / ${qty.toLocaleString('vi-VN')} lượt)
              </span>
              ${refreshBtn}
            </div>
          </div>

          <div style="height: 10px; width: 100%; background: #e2e8f0; border-radius: 999px; overflow: hidden; margin-bottom: 12px;">
            <div style="height: 100%; width: ${progressPct}%; background: linear-gradient(90deg, #007BFF 0%, ${barColor} 100%); border-radius: 999px; transition: width 0.5s ease;"></div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; text-align: center;">
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 6px;">
              <div style="color: #64748b; font-size: 0.75rem; font-weight: 600; margin-bottom: 2px;">Gốc ban đầu</div>
              <div style="font-weight: 800; font-size: 1rem; color: #0f172a;">${startCount != null ? startCount.toLocaleString('vi-VN') : '-'}</div>
            </div>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 8px 6px;">
              <div style="color: #1d4ed8; font-size: 0.75rem; font-weight: 700; margin-bottom: 2px;">Đã tăng</div>
              <div style="font-weight: 800; font-size: 1rem; color: #007BFF;">+${delivered.toLocaleString('vi-VN')}</div>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px 6px;">
              <div style="color: #15803d; font-size: 0.75rem; font-weight: 700; margin-bottom: 2px;">Hiện tại</div>
              <div style="font-weight: 800; font-size: 1rem; color: #16a34a;">${currentCount != null ? currentCount.toLocaleString('vi-VN') : '-'}</div>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 6px;">
              <div style="color: #b45309; font-size: 0.75rem; font-weight: 700; margin-bottom: 2px;">Còn lại / Mua</div>
              <div style="font-weight: 800; font-size: 1rem; color: #d97706;">${remains.toLocaleString('vi-VN')} / ${qty.toLocaleString('vi-VN')}</div>
            </div>
          </div>
        </div>
      `;
    }

    let updateActionHtml = "";
    if (o.needs_customer_update) {
      const isCode = o.customer_update_type === "code";
      const placeholder = isCode ? "Dán mã mời hoặc link sự kiện Liên Quân mới vào đây..." : "Dán link bài viết công khai mới vào đây...";
      const label = isCode ? "mã mời Liên Quân" : "link bài viết mạng xã hội";

      updateActionHtml = `
        <div class="lookup-fix-box" style="margin-top: 14px; padding: 14px; background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border: 2px solid #f97316; border-radius: 12px; box-shadow: 0 4px 14px rgba(249, 115, 22, 0.15);">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <i class="fa-solid fa-triangle-exclamation" style="color: #ea580c; font-size: 1.15rem;"></i>
            <span style="font-weight: 800; font-size: 0.95rem; color: #9a3412;">YÊU CẦU ĐIỀN LẠI ${isCode ? 'MÃ MỜI' : 'LINK'} MỚI</span>
          </div>
          <p style="font-size: 0.85rem; color: #7c2d12; line-height: 1.5; margin-bottom: 12px;">
            ${o.customer_error_msg || `Hệ thống kiểm tra thấy ${label} bạn cung cấp không hợp lệ hoặc đã hết hạn. Vui lòng nhập link hoặc mã mới bên dưới để hệ thống tiếp tục xử lý tự động!` }
          </p>
          <div style="display: flex; gap: 8px; flex-direction: column;">
            <input type="text" id="inputUpdateTarget_${o.order_id}" class="form-input" placeholder="${placeholder}" aria-label="Cập nhật link hoặc thông tin đơn hàng mới" style="width: 100%; padding: 11px 14px; font-size: 0.9rem; border: 1.5px solid #fdba74; border-radius: 8px; background: #ffffff; color: #0f172a; box-sizing: border-box;" />
            <button type="button" class="btn-primary-gradient" id="btnUpdateTarget_${o.order_id}" onclick="submitCustomerTargetUpdate('${o.order_id}', '${isCode ? 'code' : 'link'}')" style="padding: 11px 16px; font-size: 0.9rem; font-weight: 700; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #ea580c 0%, #f97316 100%); cursor: pointer; border: none; border-radius: 8px; color: #fff;">
              <i class="fa-solid fa-paper-plane"></i>
              <span>Cập Nhật & Xử Lý Lại Ngay</span>
            </button>
          </div>
        </div>
      `;
    }

    let processingNote = "";
    if (st === "COMPLETED") {
      processingNote = `
        <div style="font-size: 0.86rem; color: #166534; font-weight: 700; margin-top: 12px; padding: 10px 14px; background: #f0fdf4; border-radius: 10px; border: 1.5px solid #86efac; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-circle-check text-green" style="font-size: 1.15rem;"></i>
          <span>Đơn hàng đã hoàn thành 100%! Cảm ơn bạn đã tin dùng dịch vụ.</span>
        </div>
      `;
    } else if (!o.needs_customer_update && (st === "PROCESSING" || st === "PAID")) {
      processingNote = `
        <div style="font-size: 0.84rem; color: #1e40af; margin-top: 12px; padding: 10px 14px; background: #eff6ff; border-radius: 10px; border: 1.5px solid #bfdbfe; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-bolt text-blue"></i>
            <span>Đơn hàng đang chạy tự động. Bấm <strong>Cập nhật</strong> để kiểm tra tiến độ mới nhất!</span>
          </div>
          <button type="button" onclick="refreshOrderProgress('${o.order_id}')" style="background:#2563eb;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">
            <i class="fa-solid fa-arrows-rotate"></i> Cập nhật ngay
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="lookup-card-header">
        <div>
          <span class="lookup-oid">${o.order_id}</span>
          <span class="lookup-date">• ${o.created_time || ""}</span>
        </div>
        ${statusHtml}
      </div>
      <div class="lookup-card-body">
        <div class="lookup-row"><span>Dịch vụ:</span> <strong>${o.package_name || "Dịch vụ"}</strong></div>
        ${o.platform_name ? `<div class="lookup-row"><span>Nền tảng:</span> <strong class="text-gold">${o.platform_name}</strong></div>` : ""}
        ${o.target ? `<div class="lookup-row"><span>Tài khoản/Email:</span> <code>${o.target}</code></div>` : ""}
        ${o.duration ? `<div class="lookup-row"><span>Thời hạn:</span> <strong class="text-cyan">${o.duration}</strong></div>` : ""}
        <div class="lookup-row"><span>Số tiền:</span> <strong class="text-gold">${o.amount_formatted || (o.amount + "đ")}</strong></div>
        ${o.zalo ? `<div class="lookup-row"><span>Zalo:</span> <code>${o.zalo}</code></div>` : ""}
        ${o.code ? `<div class="lookup-row"><span>Mã Liên Quân:</span> <code>${o.code}</code></div>` : ""}
        ${o.username ? `<div class="lookup-row"><span>Username Locket:</span> <code>@${o.username}</code></div>` : ""}
        ${o.link ? `<div class="lookup-row"><span>Link MXH:</span> <span class="lookup-link" title="${o.link}">${o.link}</span></div>` : ""}
        ${o.paid_at ? `<div class="lookup-row"><span>Thanh toán lúc:</span> <span class="text-green">${o.paid_at}</span></div>` : ""}
        ${progressHtml}
        ${updateActionHtml}
        ${processingNote}
        ${vipDownloadHtml}
        ${vipPremiumHtml}
      </div>
      ${payBtnHtml ? `<div class="lookup-card-footer">${payBtnHtml}</div>` : ""}
    `;

    container.appendChild(card);
  });
}

async function submitCustomerTargetUpdate(orderId, type) {
  const inputElem = document.getElementById(`inputUpdateTarget_${orderId}`);
  const btnElem = document.getElementById(`btnUpdateTarget_${orderId}`);
  if (!inputElem || !btnElem) return;

  const newTarget = inputElem.value.trim();
  if (!newTarget) {
    showToast(type === "code" ? "Vui lòng nhập mã mời hoặc link sự kiện mới!" : "Vui lòng nhập link bài viết mới!", "warning");
    inputElem.focus();
    return;
  }

  btnElem.disabled = true;
  btnElem.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi và kích hoạt lại...`;

  try {
    const res = await fetch("/api/order/update-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, new_target: newTarget })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.msg || "Cập nhật thành công! Hệ thống đang xử lý.", "success");
      setTimeout(() => {
        runOrderLookup(orderId);
      }, 900);
    } else {
      showToast(data.msg || "Có lỗi xảy ra, vui lòng thử lại!", "error");
      btnElem.disabled = false;
      btnElem.innerHTML = `<i class="fa-solid fa-paper-plane"></i> <span>Cập Nhật & Xử Lý Lại Ngay</span>`;
    }
  } catch (err) {
    showToast("Lỗi kết nối: " + err.message, "error");
    btnElem.disabled = false;
    btnElem.innerHTML = `<i class="fa-solid fa-paper-plane"></i> <span>Cập Nhật & Xử Lý Lại Ngay</span>`;
  }
}

// ==========================================
// 5. SMART PAYMENT MODAL (VIETQR)
// ==========================================

// ==========================================
// MODAL & SCROLL CONTROL MANAGER
// ==========================================
function openModal(modalId) {
  const modal = typeof modalId === "string" ? document.getElementById(modalId) : modalId;
  if (!modal) return;
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeModal(modalId) {
  const modal = typeof modalId === "string" ? document.getElementById(modalId) : modalId;
  if (modal) {
    modal.style.display = "none";
  }
  const openModals = Array.from(document.querySelectorAll('.modal-backdrop')).filter(m => {
    return window.getComputedStyle(m).display !== 'none';
  });
  if (openModals.length === 0) {
    document.body.style.overflow = "";
  }
}

function initPaymentModal() {
  const closeBtn = document.getElementById("btnCloseModal");
  const confirmBtn = document.getElementById("btnConfirmPaidNow");

  closeBtn.addEventListener("click", closePaymentModal);
  confirmBtn.addEventListener("click", () => {
    if (!gCurrentOrder) return;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang quét ngân hàng...`;

    fetch("/api/order/confirm-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: gCurrentOrder.order_id })
    })
      .then(r => r.json())
      .then(data => {
        if (data.is_paid) {
          handlePaymentSuccess(data.order);
        } else {
          showToast("Hệ thống chưa thấy tiền vào tài khoản. Hãy chắc chắn bạn đã chuyển đúng số tiền và nội dung!", "info");
        }
      })
      .catch(e => showToast("Lỗi kiểm tra: " + e.message, "error"))
      .finally(() => {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Tôi Đã Chuyển Khoản Thành Công</span>`;
      });
  });
}

function openPaymentModal(order) {
  gCurrentOrder = order;
  gCurrentOrderId = order.order_id;
  gPaymentEndTime = Date.now() + (15 * 60 * 1000);
  savePendingOrder(order);

  // Reset modal display elements
  const qrWrap = document.querySelector("#paymentModal .qr-code-wrapper");
  const bankBox = document.querySelector("#paymentModal .bank-details-box");
  const footer = document.querySelector("#paymentModal .modal-footer");
  const succBox = document.getElementById("payModalSuccessBox");
  if (qrWrap) qrWrap.style.display = "";
  if (bankBox) bankBox.style.display = "";
  if (footer) footer.style.display = "";
  if (succBox) { succBox.style.display = "none"; succBox.innerHTML = ""; }

  document.getElementById("payModalOrderId").textContent = order.order_id;
  document.getElementById("payModalServiceTitle").textContent = order.package_name || "Thanh Toán Đơn Hàng";
  const qrImg = document.getElementById("qrImage") || document.getElementById("payModalQrImg");
  if (qrImg && order.qr_url) {
    qrImg.src = order.qr_url;
  }
  document.getElementById("payModalBankName").textContent = order.bank_name || "Ngân Hàng Bản Việt (BVBank - ZaloPay)";
  document.getElementById("payModalAccNo").textContent = order.account_number || "99ZP24261M43061759";
  document.getElementById("payModalAccName").textContent = order.account_name || "ZALOPAY_DINH TUAN HUNG";
  document.getElementById("payModalAmount").textContent = order.amount_formatted || `${order.amount.toLocaleString("vi-VN")}đ`;
  document.getElementById("payModalContent").textContent = order.content || order.order_id;

  startPaymentTimer(15 * 60);
  startPaymentPolling(order.order_id);

  openModal("paymentModal");
}

function closePaymentModal() {
  if (window.paymentCountdown) {
    clearInterval(window.paymentCountdown);
    window.paymentCountdown = null;
  }
  if (gCountdownTimer) {
    clearInterval(gCountdownTimer);
    gCountdownTimer = null;
  }
  if (gPayPollTimer) {
    clearInterval(gPayPollTimer);
    gPayPollTimer = null;
  }
  closeModal("paymentModal");
}

function startPaymentTimer(duration) {
  gPaymentEndTime = Date.now() + ((duration || 15 * 60) * 1000);
  const display = document.getElementById("payModalCountdown");
  if (window.paymentCountdown) {
    clearInterval(window.paymentCountdown);
    window.paymentCountdown = null;
  }
  if (gCountdownTimer) {
    clearInterval(gCountdownTimer);
    gCountdownTimer = null;
  }

  const updateDisplay = () => {
    const diff = Math.max(0, Math.floor((gPaymentEndTime - Date.now()) / 1000));
    let minutes = parseInt(diff / 60, 10);
    let seconds = parseInt(diff % 60, 10);

    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;

    if (display) display.textContent = minutes + ":" + seconds;

    if (diff <= 0) {
      if (window.paymentCountdown) clearInterval(window.paymentCountdown);
      if (gCountdownTimer) clearInterval(gCountdownTimer);
      window.paymentCountdown = null;
      gCountdownTimer = null;
      if (display) display.textContent = "HẾT HẠN";
    }
  };

  updateDisplay();
  window.paymentCountdown = gCountdownTimer = setInterval(updateDisplay, 1000);
}

const hasShownSuccessModal = {};
function startPaymentPolling(orderId) {
  if (gPayPollTimer) {
    clearInterval(gPayPollTimer);
    gPayPollTimer = null;
  }

  let pollAttempts = 0;
  const maxAttempts = 180; // 15 phút tối đa

  gPayPollTimer = setInterval(async () => {
    // Tiết kiệm tài nguyên Vercel: Dừng poll khi tab bị ẩn
    if (document.hidden) return;

    pollAttempts++;
    if (pollAttempts > maxAttempts) {
      if (gPayPollTimer) { clearInterval(gPayPollTimer); gPayPollTimer = null; }
      return;
    }

    try {
      const res = await fetch(`/api/payment/check/${orderId}`);
      if (res.status === 404) {
        if (gPayPollTimer) { clearInterval(gPayPollTimer); gPayPollTimer = null; }
        clearPendingOrder();
        try {
          localStorage.removeItem("dthPaidOrder");
          localStorage.removeItem("dthTrackedOrder");
          let recent = JSON.parse(localStorage.getItem("dth_recent_orders") || "[]").filter(o => o.order_id !== orderId);
          localStorage.setItem("dth_recent_orders", JSON.stringify(recent));
          let userOrders = JSON.parse(localStorage.getItem("dth_user_orders") || "[]").filter(o => o.order_id !== orderId);
          localStorage.setItem("dth_user_orders", JSON.stringify(userOrders));
        } catch (e) {}
        return;
      }
      const data = await res.json();
      if (!data.success && (data.msg?.includes("không tìm thấy") || data.msg?.includes("not found"))) {
        if (gPayPollTimer) { clearInterval(gPayPollTimer); gPayPollTimer = null; }
        clearPendingOrder();
        return;
      }
      if (data.success && data.status && data.status !== "PENDING") {
        if (gPayPollTimer) { clearInterval(gPayPollTimer); gPayPollTimer = null; }
        handlePaymentSuccess(data.order || { order_id: orderId, status: data.status });
      }
    } catch (e) {
      // quiet poll error
    }
  }, 4000);
}

function handlePaymentSuccess(order) {
  if (!order || !order.order_id) return;
  if (gPayPollTimer) { clearInterval(gPayPollTimer); gPayPollTimer = null; }
  if (window.paymentCountdown) { clearInterval(window.paymentCountdown); window.paymentCountdown = null; }
  if (gCountdownTimer) { clearInterval(gCountdownTimer); gCountdownTimer = null; }

  if (hasShownSuccessModal[order.order_id]) {
    return;
  }
  hasShownSuccessModal[order.order_id] = true;

  showToast(`🎉 Thanh toán thành công đơn #${order.order_id}!`, "success");
  playSuccessChime();
  triggerConfetti();
  saveUserOrderLocal(order);
  clearPendingOrder();
  gVipPaidOrder = order;
  try {
    localStorage.setItem("dthPaidOrder", JSON.stringify({
      order_id: order.order_id,
      token: order.token || order.video_token || "",
      video_token: order.video_token || order.token || "",
      status: order.status || "PAID"
    }));
  } catch (e) {}

  const modal = document.getElementById("paymentModal");
  if (!modal || modal.style.display === "none") {
    switchTab("lookup");
    document.getElementById("lookupInput").value = order.order_id;
    performLookup();
    return;
  }

  // Hide payment details and render instant in-modal guide
  const qrWrap = modal.querySelector(".qr-code-wrapper");
  const bankBox = modal.querySelector(".bank-details-box");
  const footer = modal.querySelector(".modal-footer");
  const succBox = document.getElementById("payModalSuccessBox");

  if (qrWrap) qrWrap.style.display = "none";
  if (bankBox) bankBox.style.display = "none";
  if (footer) footer.style.display = "none";

  const isLocket = (order.service_type === "locket" || String(order.order_id).startsWith("LK"));
  const cleanUser = cleanLocketUser(order.username || "") || "VIP";
  const moduleUrl = order.module_link || "";
  const shadowScheme = order.shadowrocket_install_url || `shadowrocket://install?module=${encodeURIComponent(moduleUrl)}`;

  if (succBox) {
    succBox.style.display = "block";
    if (isLocket) {
      succBox.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-size: 2.2rem; margin-bottom: 12px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <h3 style="font-size: 1.35rem; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">Thanh Toán & Kích Hoạt Thành Công!</h3>
          <p style="font-size: 0.92rem; color: var(--text-muted);">
            Mã đơn: <strong class="text-gold">#${order.order_id}</strong> • Tài khoản: <strong style="color: var(--blue-primary);">@${cleanUser}</strong>
          </p>
        </div>

        <div class="vip-gold-box" style="background: var(--blue-subtle); border: 1.5px solid var(--border-blue); border-radius: var(--radius-md); padding: 20px; margin-top: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 800; color: var(--blue-primary); font-size: 0.95rem;">
              <i class="fa-solid fa-crown" style="color: #f59e0b;"></i>
              <span>CẤU HÌNH & MODULE SHADOWROCKET GIỮ GOLD VIP (IOS)</span>
            </div>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #059669; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
              <i class="fa-solid fa-circle-check"></i> ĐÃ KÍCH HOẠT
            </span>
          </div>

          <p style="font-size: 0.88rem; color: var(--text-sub); margin-bottom: 16px; line-height: 1.55;">
            Đơn hàng Locket Gold đã kích hoạt thành công! Cài đặt ngay Module Shadowrocket All-in-One độc quyền (dth.sgmodule) để mở khóa Gold vĩnh viễn, video dài 60s và khung Widget VIP:
          </p>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <a href="${shadowScheme}" class="vip-dl-btn btn-vip-module" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%) !important; color: #ffffff !important; text-decoration: none;">
              <span style="display: flex; align-items: center; gap: 10px; color: #ffffff !important;">
                <i class="fa-solid fa-bolt" style="color: #fef08a !important; font-size: 1.25rem;"></i>
                <span style="color: #ffffff !important; font-weight: 800;">Cài Thẳng Vào Shadowrocket (1-Click)</span>
              </span>
              <i class="fa-solid fa-arrow-up-right-from-square" style="color: #ffffff !important;"></i>
            </a>

            <button type="button" class="vip-dl-btn btn-vip-copy" onclick="copyToClipboard('${moduleUrl}', 'Đã sao chép link module Shadowrocket!')" style="background: linear-gradient(135deg, #059669 0%, #047857 100%) !important; color: #ffffff !important; border: none !important; cursor: pointer;">
              <span style="display: flex; align-items: center; gap: 10px; color: #ffffff !important;">
                <i class="fa-regular fa-copy" style="font-size: 1.25rem; color: #ffffff !important;"></i>
                <span style="color: #ffffff !important; font-weight: 700;">Sao Chép Link Module: <strong style="color: #a7f3d0 !important;">dth.sgmodule</strong></span>
              </span>
              <i class="fa-solid fa-clone" style="color: #a7f3d0 !important;"></i>
            </button>

            <button type="button" class="vip-dl-btn btn-vip-reup" onclick="customerReupGold('${cleanUser}', '${order.order_id}')" style="background: linear-gradient(135deg, #d97706 0%, #b45309 100%) !important; color: #ffffff !important; border: none !important; cursor: pointer;">
              <span style="display: flex; align-items: center; gap: 10px; color: #ffffff !important;">
                <i class="fa-solid fa-rotate-right" style="color: #ffffff !important; font-size: 1.15rem;"></i>
                <span style="color: #ffffff !important; font-weight: 700;">Lên Lại / Kích Hoạt Lại Gold (Khách Cũ)</span>
              </span>
              <i class="fa-solid fa-crown" style="color: #fef08a !important;"></i>
            </button>

            <a href="/download-config?u=${encodeURIComponent(cleanUser)}" class="vip-dl-btn btn-vip-gold" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important; color: #ffffff !important; text-decoration: none;">
              <span style="display: flex; align-items: center; gap: 10px; color: #ffffff !important;">
                <i class="fa-brands fa-apple" style="font-size: 1.35rem; color: #ffffff !important;"></i>
                <span style="color: #ffffff !important; font-weight: 700;">Tải File DNS Profile: LocketGold_${cleanUser}.mobileconfig</span>
              </span>
              <i class="fa-solid fa-download" style="color: #ffffff !important;"></i>
            </a>

            <button type="button" class="btn-vip-video" onclick="openVideoGuideModal('${order.order_id}', '${order.token || order.video_token || ''}')" style="">
              <i class="fa-solid fa-circle-play" style="color: #2563eb; font-size: 1.15rem;"></i>
              <span>Xem Video Hướng Dẫn Cài Shadowrocket & DNS (30 Giây)</span>
            </button>

            <div style="margin-top: 12px; text-align: center; padding: 10px 14px; background: rgba(254, 240, 138, 0.25); border-radius: 8px; border: 1px dashed #f59e0b;">
              <a href="https://locket.cam/dth206" target="_blank" rel="noopener noreferrer" style="color: #b45309; font-weight: 700; text-decoration: none; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-heart" style="color: #ff3366; animation: heartbeat 1.5s infinite; display: inline-block;"></i>
                <span>💛 Nhấn vào đây để kết bạn Locket cùng chủ shop nha: <strong>locket.cam/dth206</strong></span>
              </a>
            </div>
          </div>
        </div>

        <div style="margin-top: 18px; display: flex; gap: 10px; justify-content: center;">
          <button type="button" class="btn-secondary" onclick="closePaymentModal(); switchTab('lookup'); document.getElementById('lookupInput').value='${order.order_id}'; performLookup();" style="padding: 10px 20px; font-weight: 700; border-radius: 10px; border: 1px solid var(--border-subtle); background: #f8fafc; color: var(--text-main); cursor: pointer;">
            <i class="fa-solid fa-magnifying-glass"></i> Mở Trong Trang Tra Cứu Đơn
          </button>

          <button type="button" class="btn-secondary" onclick="openReceiptModal(gCurrentOrder || order)" style="padding: 10px 18px; font-weight: 700; border-radius: 10px; border: 1.5px solid #2563eb; background: #ffffff; color: #2563eb; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-receipt"></i> <span>Tạo Biên Lai / Hóa Đơn Điện Tử</span>
          </button>

        </div>
      `;
    } else {
      succBox.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-size: 2.2rem; margin-bottom: 12px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <h3 style="font-size: 1.35rem; font-weight: 800; color: var(--text-main); margin-bottom: 6px;">Thanh Toán Thành Công!</h3>
          <p style="font-size: 0.92rem; color: var(--text-muted);">
            Mã đơn: <strong class="text-gold">#${order.order_id}</strong> • Trạng thái: <strong style="color: #059669;">ĐÃ DUYỆT TỰ ĐỘNG</strong>
          </p>
        </div>
        <div style="background: var(--bg-subtle); border-radius: 12px; padding: 16px; margin-bottom: 16px; font-size: 0.9rem; line-height: 1.6;">
          <p>Hệ thống đã ghi nhận thanh toán và đang xử lý bàn giao dịch vụ tự động cho bạn.</p>
        </div>
        <div style="text-align: center;">
          <button type="button" class="btn-primary-gradient" onclick="closePaymentModal(); switchTab('lookup'); document.getElementById('lookupInput').value='${order.order_id}'; performLookup();" style="padding: 12px 24px; font-weight: 700; border-radius: 10px; cursor: pointer;">
            <i class="fa-solid fa-magnifying-glass"></i> Kiểm Tra Tiến Độ & Bàn Giao
          </button>
        </div>
      `;
    }
  }
}

// ==========================================
// 6. LIVE TICKER (SOCIAL PROOF)
// ==========================================
function initLiveTicker() {
  fetchRecentTicker();
  // Tiết kiệm tài nguyên Vercel: Giảm tần suất gọi API lên 60s và chỉ gọi khi tab hiển thị
  setInterval(() => {
    if (!document.hidden) {
      fetchRecentTicker();
    }
  }, 60000);
}

const MOCK_FALLBACK_TICKERS = [
  { user: "0987***312", desc: "vừa hoàn tất Gói Chung Sức 340 lượt mở rương SSS" },
  { user: "@minhtuyet_09", desc: "vừa kích hoạt Locket Gold VIP (Vĩnh Viễn)" },
  { user: "0379***888", desc: "vừa tăng 1.000 Follow TikTok người dùng thật" },
  { user: "0912***456", desc: "vừa nhận 4 gói tùy chọn (152 lượt) mở rương thành công" },
  { user: "@dth206", desc: "vừa cài đặt Module Shadowrocket All-in-One độc quyền" },
  { user: "0899***660", desc: "vừa tăng 500 Tym Video TikTok lên xu hướng" },
  { user: "@tolatduong", desc: "vừa tải cấu hình DNS Locket Gold chống quét trọn đời" },
  { user: "0905***777", desc: "vừa hoàn thành đơn Tăng Tương Tác Facebook thành công" }
];

function fetchRecentTicker() {
  fetch("/api/public/recent-history")
    .then(r => r.json())
    .then(data => {
      if (data.success && data.items && data.items.length > 0) {
        const item = data.items[Math.floor(Math.random() * data.items.length)];
        showLiveTickerToast(item.user, item.desc);
      } else {
        const fallback = MOCK_FALLBACK_TICKERS[Math.floor(Math.random() * MOCK_FALLBACK_TICKERS.length)];
        showLiveTickerToast(fallback.user, fallback.desc);
      }
    })
    .catch(() => {
      const fallback = MOCK_FALLBACK_TICKERS[Math.floor(Math.random() * MOCK_FALLBACK_TICKERS.length)];
      showLiveTickerToast(fallback.user, fallback.desc);
    });
}

function showLiveTickerToast(user, desc) {
  const toast = document.getElementById("liveTickerToast");
  const uElem = document.getElementById("tickerUser");
  const dElem = document.getElementById("tickerDesc");

  if (!toast || !uElem || !dElem) return;

  uElem.textContent = user;
  dElem.textContent = desc;

  toast.classList.remove("hidden");
  toast.style.display = "flex";
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.style.display = "none";
      toast.classList.add("hidden");
    }, 400);
  }, 5000);
}

// ==========================================
// VIDEO GUIDE MODAL (VIP PAID ONLY)
// ==========================================
let gCurrentVideoTab = "shadowrocket";
let gVipPaidOrder = null;

function getActiveVipOrder() {
  if (gVipPaidOrder && ["PAID", "PROCESSING", "COMPLETED"].includes(gVipPaidOrder.status)) {
    return gVipPaidOrder;
  }
  if (gCurrentOrder && ["PAID", "PROCESSING", "COMPLETED"].includes(gCurrentOrder.status)) {
    return gCurrentOrder;
  }
  try {
    const saved = JSON.parse(localStorage.getItem("dthPaidOrder") || "null");
    if (saved && saved.order_id && (saved.token || saved.video_token)) {
      return saved;
    }
  } catch (e) {}
  return null;
}

function switchVideoGuideTab(tab) {
  gCurrentVideoTab = tab;
  const tabSr = document.getElementById("btnVideoTabSr") || document.getElementById("btnVideoTabDns");
  const tabMod = document.getElementById("btnVideoTabMod");
  const title = document.getElementById("videoModalTitle");
  const player = document.getElementById("guideVideoPlayer");
  const lockOverlay = document.getElementById("videoLockOverlay");
  const list1 = document.getElementById("videoGuideList1") || document.getElementById("stepsShadowrocket") || document.getElementById("stepsDns");
  const list2 = document.getElementById("videoGuideList2") || document.getElementById("stepsModule");

  const isModuleTab = (tab === "module" || tab === "mod" || tab === "shadowrocket_mod");

  if (isModuleTab) {
    if (tabSr) {
      tabSr.classList.remove("active");
      tabSr.setAttribute("aria-selected", "false");
    }
    if (tabMod) {
      tabMod.classList.add("active");
      tabMod.setAttribute("aria-selected", "true");
    }
    if (title) title.innerHTML = '<i class="fa-solid fa-bolt text-yellow"></i> Video 2: Thêm Module Locket Gold VIP';
    if (list1) {
      list1.style.setProperty("display", "none", "important");
      list1.classList.add("hidden");
    }
    if (list2) {
      list2.style.setProperty("display", "block", "important");
      list2.classList.remove("hidden");
    }
  } else {
    if (tabMod) {
      tabMod.classList.remove("active");
      tabMod.setAttribute("aria-selected", "false");
    }
    if (tabSr) {
      tabSr.classList.add("active");
      tabSr.setAttribute("aria-selected", "true");
    }
    if (title) title.innerHTML = '<i class="fa-solid fa-circle-play text-blue"></i> Video 1: Cài Đặt Shadowrocket';
    if (list1) {
      list1.style.setProperty("display", "block", "important");
      list1.classList.remove("hidden");
    }
    if (list2) {
      list2.style.setProperty("display", "none", "important");
      list2.classList.add("hidden");
    }
  }

  const vipOrder = getActiveVipOrder();
  if (vipOrder && (vipOrder.token || vipOrder.video_token)) {
    // Unlocked VIP player mode
    if (lockOverlay) lockOverlay.style.display = "none";
    if (player) {
      player.style.display = "block";
      player.onerror = () => {
        if (lockOverlay) lockOverlay.style.display = "flex";
        player.style.display = "none";
        showToast("Quyền truy cập video bị từ chối hoặc video chưa sẵn sàng.", "error");
      };
      const vidType = isModuleTab ? "module" : "shadowrocket";
      const token = vipOrder.video_token || vipOrder.token;
      const videoUrl = `/api/video/guide?type=${vidType}&order_id=${encodeURIComponent(vipOrder.order_id)}&token=${encodeURIComponent(token)}`;

      if (player.getAttribute("data-current-src") !== videoUrl) {
        player.pause();
        player.setAttribute("data-current-src", videoUrl);
        player.setAttribute("src", videoUrl);
        player.load();
      }
    }
  } else {
    // Locked VIP mode for non-paid guests
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.removeAttribute("data-current-src");
      player.load();
      player.style.display = "none";
    }
    if (lockOverlay) lockOverlay.style.display = "flex";
  }
}

function openVideoGuideModal(orderIdOrTab = "shadowrocket", token = "") {
  const modal = document.getElementById("videoModal");
  if (!modal) return;

  let targetTab = "shadowrocket";
  if (typeof orderIdOrTab === "string" && (orderIdOrTab === "shadowrocket" || orderIdOrTab === "module" || orderIdOrTab === "dns")) {
    targetTab = (orderIdOrTab === "dns" ? "shadowrocket" : orderIdOrTab);
  } else if (orderIdOrTab && typeof orderIdOrTab === "string" && orderIdOrTab.length >= 4) {
    gVipPaidOrder = {
      order_id: orderIdOrTab,
      token: token || "",
      video_token: token || "",
      status: "PAID"
    };
    try {
      localStorage.setItem("dthPaidOrder", JSON.stringify(gVipPaidOrder));
    } catch (e) {}
  }

  openModal("videoModal");
  switchVideoGuideTab(targetTab);
}

function closeVideoGuideModal() {
  const player = document.getElementById("guideVideoPlayer");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.removeAttribute("data-current-src");
    player.load();
  }
  closeModal("videoModal");
}

// ==========================================
// HELPERS
// ==========================================
function copyToClipboard(textOrElemId, customMsg) {
  let text = textOrElemId;
  const el = document.getElementById(textOrElemId);
  if (el) {
    text = el.textContent.trim();
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast(customMsg || `Đã sao chép: "${text}"`, "success");
  }).catch(() => {
    showToast("Không thể tự động sao chép, vui lòng copy thủ công.", "info");
  });
}

function copyRawAmount() {
  if (!gCurrentOrder) return;
  navigator.clipboard.writeText(String(gCurrentOrder.amount)).then(() => {
    showToast(`Đã sao chép số tiền: ${gCurrentOrder.amount}đ`, "success");
  });
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let icon = "fa-circle-info";
  if (type === "success") icon = "fa-circle-check";
  if (type === "error") icon = "fa-triangle-exclamation";

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


// ==========================================
// 4. CHỢ PREMIUM (GIAO DIỆN & LUỒNG THEO D:\dth\logo)
// ==========================================
let gPremiumServices = {};
let gSelectedPremPlatform = "";
let gSelectedPremPkg = "";

function copyBankNumber(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Đã sao chép: ${text}`, "success");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast(`Đã sao chép: ${text}`, "success");
  });
}

function pasteToCartTarget() {
  navigator.clipboard.readText().then(text => {
    const input = document.getElementById("cartTargetInput");
    if (input && text) {
      input.value = text.trim();
      showToast("Đã dán thông tin!", "info");
    }
  }).catch(() => {
    showToast("Vui lòng tự nhập vào ô.", "info");
  });
}

function applyMarketEnabledState(isEnabled) {
  // 1. Ẩn/Hiện nút Tab trên thanh điều hướng máy tính (Desktop Header)
  document.querySelectorAll('.service-tab-btn[data-tab="premium"]').forEach(el => {
    if (isEnabled) {
      el.style.removeProperty('display');
    } else {
      el.style.setProperty('display', 'none', 'important');
    }
  });

  // 2. Ẩn/Hiện nút Tab trên thanh điều hướng chân trang (Mobile Bottom Nav)
  document.querySelectorAll('.mobile-bottom-nav-btn[data-tab="premium"]').forEach(el => {
    if (isEnabled) {
      el.style.removeProperty('display');
    } else {
      el.style.setProperty('display', 'none', 'important');
    }
  });

  // 3. Xử lý hiển thị bên trong Panel Chợ Premium
  const panel = document.getElementById("panel-premium");
  if (panel) {
    const orderGrid = panel.querySelector(".order-grid");
    const filterGroup = document.getElementById("premPlatformFilter");
    const heroSec = panel.querySelector(".hero-premium");

    let closedBanner = document.getElementById("premClosedBanner");
    if (!isEnabled) {
      if (orderGrid) orderGrid.style.setProperty('display', 'none', 'important');
      if (filterGroup) filterGroup.style.setProperty('display', 'none', 'important');
      if (heroSec) heroSec.style.setProperty('display', 'none', 'important');

      if (!closedBanner) {
        closedBanner = document.createElement("div");
        closedBanner.id = "premClosedBanner";
        closedBanner.className = "hero-section hero-premium";
        closedBanner.style.cssText = "margin-top: 10px; text-align: center;";
        closedBanner.innerHTML = `
          <div class="hero-badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 0.85rem;">
            <i class="fa-solid fa-store-slash"></i> TẠM NGƯNG DỊCH VỤ
          </div>
          <h1 class="hero-title" style="margin-top: 12px; font-size: 1.85rem; font-weight: 900; color: #0f172a;">Chợ Dịch Vụ Premium Tạm Đóng</h1>
          <p class="hero-desc" style="max-width: 580px; margin: 10px auto 0; font-size: 0.95rem; color: #64748b; line-height: 1.6;">
            Hệ thống đang bảo trì và cập nhật kho tài khoản. Quý khách vui lòng quay lại sau ít phút hoặc nhắn tin Zalo hỗ trợ!
          </p>
        `;
        panel.prepend(closedBanner);
      } else {
        closedBanner.style.removeProperty('display');
      }

      // Nếu khách đang mở tab #premium, tự động chuyển mượt sang tab dịch vụ đang hoạt động
      if (window.location.hash === "#premium") {
        const firstActiveBtn = document.querySelector(".service-tab-btn:not([data-tab='premium']):not([style*='display: none'])");
        if (firstActiveBtn && firstActiveBtn.dataset.tab) {
          switchTab(firstActiveBtn.dataset.tab);
        }
      }
    } else {
      if (closedBanner) closedBanner.style.setProperty('display', 'none', 'important');
      if (orderGrid) orderGrid.style.removeProperty('display');
      if (filterGroup) filterGroup.style.removeProperty('display');
      if (heroSec) heroSec.style.removeProperty('display');
    }
  }
}

function initPremium() {
  const panel = document.getElementById("panel-premium");
  if (!panel) return;

  const btnPaste = document.getElementById("btnPastePremTarget") || document.getElementById("btnPasteCartTarget");
  if (btnPaste) {
    btnPaste.addEventListener("click", pasteToPremTarget);
  }

  fetch("/api/premium/services")
    .then(r => r.json())
    .then(data => {
      if (!data || !data.success) return;

      const isMarketEnabled = (data.market_enabled !== false);
      applyMarketEnabledState(isMarketEnabled);

      if (isMarketEnabled && data.services) {
        gPremiumServices = data.services;
        renderPremiumPlatforms();
      }
    })
    .catch(err => console.error("Error loading premium services:", err));
}

function pasteToPremTarget() {
  const targetInput = document.getElementById("premTargetInput") || document.getElementById("cartTargetInput");
  if (!targetInput) return;
  navigator.clipboard.readText().then(text => {
    if (text) {
      targetInput.value = text.trim();
      showToast("Đã dán thông tin!", "success");
    }
  }).catch(() => {
    showToast("Vui lòng tự nhập vào ô.", "info");
  });
}

function renderPremiumPlatforms() {
  const filterWrap = document.getElementById("premPlatformFilter");
  if (!filterWrap) return;

  const sids = Object.keys(gPremiumServices).filter(k => gPremiumServices[k].active !== false);
  const orderGrid = document.querySelector("#panel-premium .order-grid");

  if (sids.length === 0) {
    filterWrap.innerHTML = `
      <div style="text-align: center; width: 100%; padding: 26px 16px; background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 14px; margin-bottom: 20px;">
        <i class="fa-solid fa-box-open text-muted" style="font-size: 2rem; margin-bottom: 8px; display: block; color: #94a3b8;"></i>
        <div style="font-weight: 700; color: #334155; font-size: 1rem;">Hiện tại các dịch vụ trong chợ đang tạm ngưng nhận đơn mới.</div>
        <div style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;">Quý khách vui lòng quay lại sau hoặc liên hệ Zalo hỗ trợ!</div>
      </div>
    `;
    if (orderGrid) orderGrid.style.setProperty("display", "none", "important");
    return;
  }

  if (orderGrid) orderGrid.style.removeProperty("display");
  filterWrap.innerHTML = "";
  sids.forEach((sid, idx) => {
    const svc = gPremiumServices[sid];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `platform-pill ${idx === 0 ? "active" : ""}`;
    btn.dataset.platform = sid;
    const icon = svc.icon || "fa-solid fa-gem";
    btn.innerHTML = `<i class="${icon}"></i> <span>${svc.name}</span>`;
    btn.addEventListener("click", () => selectPremiumPlatform(sid));
    filterWrap.appendChild(btn);
  });

  if (sids.length > 0) {
    if (!gSelectedPremPlatform || !sids.includes(gSelectedPremPlatform)) {
      selectPremiumPlatform(sids[0]);
    } else {
      selectPremiumPlatform(gSelectedPremPlatform);
    }
  }
}

function selectPremiumPlatform(sid) {
  const svc = gPremiumServices[sid];
  if (!svc) return;

  gSelectedPremPlatform = sid;

  // Active pill state
  document.querySelectorAll("#premPlatformFilter .platform-pill").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.platform === sid);
  });

  // Form title
  const formTitle = document.getElementById("premFormTitle");
  if (formTitle) {
    formTitle.textContent = `Đăng Ký Bản Quyền ${svc.name}`;
  }

  // Label & placeholder & hint for target
  const targetLabel = document.getElementById("premTargetLabel");
  if (targetLabel) {
    targetLabel.innerHTML = `<span class="step-num">2</span> ${svc.input_label || "Email / Tài Khoản Nhận Bản Quyền"} <span class="req">*</span>`;
  }

  const targetInput = document.getElementById("premTargetInput");
  if (targetInput) {
    targetInput.placeholder = svc.input_placeholder || "Nhập Email hoặc Tài khoản nhận...";
  }

  const targetHint = document.getElementById("premTargetHint");
  if (targetHint) {
    targetHint.innerHTML = `<i class="fa-solid fa-shield-halved text-green"></i> ${svc.guide_note || "Chỉ cần gửi Email/Tài khoản, tuyệt đối KHÔNG cần mật khẩu."}`;
  }

  // Features list
  const featTitle = document.getElementById("premFeaturesTitle");
  if (featTitle) {
    featTitle.innerHTML = `<i class="fa-solid fa-crown text-gold"></i> Đặc Quyền ${svc.name}`;
  }
  const featList = document.getElementById("premFeaturesList");
  if (featList) {
    featList.innerHTML = (svc.features || [
      "Bản quyền chính chủ 100%, bảo hành trọn đời gói",
      "Kích hoạt tự động hoặc bàn giao siêu tốc 24/7",
      "Hỗ trợ tận tình qua Zalo & Telegram"
    ]).map(f => `<li><i class="fa-solid fa-circle-check text-green"></i> <span>${f}</span></li>`).join("");
  }

  // Render Packages Grid
  const pkgGrid = document.getElementById("premPackagesGrid");
  if (!pkgGrid) return;

  pkgGrid.innerHTML = "";
  const pkgs = svc.packages || {};
  const pkgKeys = Object.keys(pkgs).filter(k => pkgs[k].active !== false);

  if (pkgKeys.length === 0) {
    pkgGrid.innerHTML = `<div class="text-muted py-3">Dịch vụ này đang cập nhật thêm các gói mới.</div>`;
    gSelectedPremPkg = "";
    updatePremiumSummary();
    return;
  }

  pkgKeys.forEach((k, idx) => {
    const p = pkgs[k];
    const card = document.createElement("div");
    card.className = `pkg-card prem-pkg-card ${idx === 0 ? "active" : ""}`;
    card.dataset.pkgId = k;
    const formattedPrice = p.price_formatted || (Number(p.price).toLocaleString("vi-VN") + "đ");
    
    card.innerHTML = `
      <div class="pkg-header">
        <span class="pkg-duration">${p.duration || p.name}</span>
        ${p.badge ? `<span class="pkg-badge">${p.badge}</span>` : ""}
      </div>
      <div class="pkg-price">${formattedPrice}</div>
      <div class="pkg-name">${p.name || ""}</div>
      ${p.desc ? `<div class="pkg-desc" style="font-size: 0.8rem; color: #64748b; margin-top: 4px; line-height: 1.3;">${p.desc}</div>` : ""}
    `;
    card.addEventListener("click", () => selectPremiumPackage(k));
    pkgGrid.appendChild(card);
  });

  // Select first package
  selectPremiumPackage(pkgKeys[0]);
}

function selectPremiumPackage(pkgId) {
  const svc = gPremiumServices[gSelectedPremPlatform];
  if (!svc) return;

  const pkg = (svc.packages || {})[pkgId];
  if (!pkg) return;

  gSelectedPremPkg = pkgId;

  document.querySelectorAll("#premPackagesGrid .pkg-card prem-pkg-card").forEach(card => {
    card.classList.toggle("active", card.dataset.pkgId === pkgId);
  });

  updatePremiumSummary();
}

function updatePremiumSummary() {
  const svc = gPremiumServices[gSelectedPremPlatform];
  const pkg = svc ? (svc.packages || {})[gSelectedPremPkg] : null;

  const summarySvc = document.getElementById("premSummaryService");
  const summaryPkg = document.getElementById("premSummaryPkg");
  const summaryDuration = document.getElementById("premSummaryDuration");
  const summaryTotal = document.getElementById("premSummaryTotal");

  if (!svc || !pkg) {
    if (summarySvc) summarySvc.textContent = "--";
    if (summaryPkg) summaryPkg.textContent = "--";
    if (summaryDuration) summaryDuration.textContent = "--";
    if (summaryTotal) summaryTotal.textContent = "0đ";
    return;
  }

  const pNum = Number(pkg.price) || 0;
  if (summarySvc) summarySvc.textContent = svc.name;
  if (summaryPkg) summaryPkg.textContent = pkg.name || pkg.duration || "Gói";
  if (summaryDuration) summaryDuration.textContent = pkg.duration || pkg.name || "--";
  if (summaryTotal) summaryTotal.textContent = `${pNum.toLocaleString("vi-VN")}đ`;
}

let isPremSubmitting = false;
async function submitPremiumOrder() {
  if (isPremSubmitting) return;
  const svc = gPremiumServices[gSelectedPremPlatform];
  if (!svc) {
    showToast("Vui lòng chọn 1 dịch vụ bản quyền!", "error");
    return;
  }

  if (!gSelectedPremPkg) {
    showToast("Vui lòng chọn gói thời hạn!", "error");
    return;
  }

  const pkg = (svc.packages || {})[gSelectedPremPkg];
  if (!pkg) {
    showToast("Gói đã chọn không hợp lệ, vui lòng chọn lại!", "error");
    return;
  }

  const targetInput = document.getElementById("premTargetInput");
  const zaloInput = document.getElementById("premZaloInput");
  const noteInput = document.getElementById("premNoteInput");
  const btn = document.getElementById("btnSubmitPremium");

  const target = (targetInput?.value || "").trim();
  const zalo = (zaloInput?.value || "").trim();
  const note = (noteInput?.value || "").trim();

  if (!target) {
    showToast(`Vui lòng nhập ${svc.input_label || "Email hoặc Tài khoản"}!`, "error");
    targetInput?.focus();
    return;
  }

  if (!zalo || zalo.length < 9) {
    showToast("Vui lòng nhập số điện thoại Zalo để nhận bàn giao!", "error");
    zaloInput?.focus();
    return;
  }

  isPremSubmitting = true;
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang khởi tạo đơn hàng...</span>`;
  }

  try {
    const { data } = await safeFetchJson("/api/premium/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: gSelectedPremPlatform,
        package_id: gSelectedPremPkg,
        target: target,
        zalo: zalo,
        note: note
      })
    });
    if (data.success && data.order) {
      showToast("Khởi tạo đơn hàng Premium thành công!", "success");
      saveRecentOrder(data.order);
      openPaymentModal(data.order);
    } else {
      showToast(data.msg || "Không thể tạo đơn hàng.", "error");
    }
  } catch (err) {
    showToast("Lỗi kết nối máy chủ: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || `<i class="fa-solid fa-crown"></i> <span>Thanh Toán & Đăng Ký Ngay</span>`;
    }
    isPremSubmitting = false;
  }
}


// =======================================================
// ADVANCED ENHANCEMENTS: THEME, AUDIO, RECEIPT, PWA, ROUTING
// =======================================================

// 2. Web Audio Synthesizer ("Ting Ting" Crystal Sound)
function playSuccessChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const playTone = (freq, delay, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + delay + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + dur);
    };

    // Harmonic bell sequence: D5 -> A5 -> D6
    playTone(587.33, 0, 0.35);
    playTone(880.00, 0.1, 0.55);
    playTone(1174.66, 0.22, 0.75);
  } catch (e) {
    console.log("Audio chime error:", e);
  }
}

// 3. Canvas Confetti Particles
function triggerConfetti() {
  let canvas = document.getElementById("confettiCanvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "confettiCanvas";
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ["#2563eb", "#38bdf8", "#fbbf24", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      r: Math.random() * 6 + 3,
      dx: (Math.random() - 0.5) * 16,
      dy: (Math.random() - 0.7) * 18,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10,
      tiltSpeed: Math.random() * 0.1 + 0.05,
      alpha: 1
    });
  }

  let animationFrame;
  let start = Date.now();

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    particles.forEach(p => {
      p.x += p.dx;
      p.y += p.dy;
      p.dy += 0.35; // gravity
      p.alpha -= 0.012;

      if (p.alpha > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    if (alive && Date.now() - start < 3500) {
      animationFrame = requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
  }

  render();
}

// 4. In-App Browser Detection (Zalo, TikTok, Messenger)
function checkInAppBrowser() {
  const ua = navigator.userAgent || "";
  const isInApp = /Zalo|TikTok|FBAN|FBAV|Instagram/i.test(ua);
  const banner = document.getElementById("inAppBrowserWarning") || document.getElementById("inAppBrowserAlert");
  if (!banner) return;
  if (isInApp) {
    banner.classList.remove("hidden");
    banner.classList.add("show-banner");
    banner.style.setProperty("display", "block", "important");
    const spanMsg = banner.querySelector("span");
    if (spanMsg) {
      const isAndroid = /Android/i.test(ua);
      if (isAndroid) {
        spanMsg.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>Bạn đang mở trong Zalo/TikTok:</strong> Vui lòng bấm dấu <strong>( ... )</strong> góc trên và chọn <strong>"Mở bằng Trình duyệt / Chrome"</strong> để trải nghiệm mượt mà!';
      } else {
        spanMsg.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>Bạn đang mở trong Zalo/TikTok:</strong> Vui lòng bấm dấu <strong>( ... )</strong> góc trên và chọn <strong>"Mở bằng Safari"</strong> để cài đặt Locket Gold một chạm!';
      }
    }
  } else {
    banner.classList.add("hidden");
    banner.classList.remove("show-banner");
    banner.style.setProperty("display", "none", "important");
  }
}

function copyCurrentUrl() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => showToast("Đã sao chép link! Hãy dán vào Safari để mở nhé.", "success"))
    .catch(() => showToast(window.location.href, "info"));
}

// 5. Electronic Receipt Generator (Biên Lai Thanh Toán Canvas)
function openReceiptModal(order) {
  const modal = document.getElementById("receiptModal");
  if (!modal) return;
  openModal("receiptModal");

  const canvas = document.getElementById("receiptCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Draw High-Res luxury receipt
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Gradient Top Bar
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, "#2563eb");
  grad.addColorStop(1, "#1d4ed8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, 100);

  // Brand Text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("DTH SERVICES", canvas.width / 2, 45);
  ctx.font = "14px sans-serif";
  ctx.fillText("HỆ THỐNG GIAO DỊCH TỰ ĐỘNG 24/7", canvas.width / 2, 75);

  // Status Badge
  ctx.fillStyle = "#10b981";
  ctx.beginPath();
  ctx.arc(canvas.width / 2, 145, 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("✓", canvas.width / 2, 155);

  ctx.fillStyle = "#10b981";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("THANH TOÁN THÀNH CÔNG", canvas.width / 2, 205);

  // Amount
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(order.amount_formatted || `${order.amount.toLocaleString("vi-VN")}đ`, canvas.width / 2, 250);

  // Divider line
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(40, 280);
  ctx.lineTo(canvas.width - 40, 280);
  ctx.stroke();

  // Receipt rows
  const rows = [
    ["Mã đơn hàng:", `#${order.order_id}`],
    ["Dịch vụ:", order.package_name || "DTH Services"],
    ["Tài khoản / Mục tiêu:", order.username ? `@${order.username}` : (order.zalo || "VIP")],
    ["Phương thức:", "VietQR Bản Việt (BVBank - ZaloPay)"],
    ["Thời gian:", order.paid_at || new Date().toLocaleString("vi-VN")],
    ["Trạng thái bàn giao:", "ĐÃ HOÀN TẤT (100%)"]
  ];

  ctx.textAlign = "left";
  let y = 325;
  rows.forEach(([label, val]) => {
    ctx.fillStyle = "#64748b";
    ctx.font = "16px sans-serif";
    ctx.fillText(label, 50, y);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(val, canvas.width - 50, y);
    ctx.textAlign = "left";

    y += 42;
  });

  // Footer note
  ctx.fillStyle = "#94a3b8";
  ctx.font = "italic 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Biên lai điện tử có giá trị bảo hành trọn đời tại https://dth206.vercel.app", canvas.width / 2, y + 40);
  ctx.fillText("Cảm ơn quý khách đã tin dùng dịch vụ của DTH Services!", canvas.width / 2, y + 65);
}

function closeReceiptModal() {
  closeModal("receiptModal");
}

function downloadReceiptImage() {
  const canvas = document.getElementById("receiptCanvas");
  if (!canvas) return;
  const link = document.createElement("a");
  link.download = `DTH_BienLai_${gCurrentOrder ? gCurrentOrder.order_id : "Receipt"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function shareReceipt() {
  const canvas = document.getElementById("receiptCanvas");
  if (!canvas) return;
  canvas.toBlob(blob => {
    if (navigator.share && blob) {
      const file = new File([blob], "bien_lai.png", { type: "image/png" });
      navigator.share({
        title: "Biên Lai Thanh Toán DTH Services",
        text: `Đã thanh toán thành công đơn #${gCurrentOrder ? gCurrentOrder.order_id : ""}`,
        files: [file]
      }).catch(() => {});
    } else {
      downloadReceiptImage();
    }
  });
}

// 6. User Orders Local Storage & Personal Stats
function saveUserOrderLocal(order) {
  if (!order || !order.order_id) return;
  try {
    let list = JSON.parse(localStorage.getItem("dth_user_orders") || "[]");
    list = list.filter(o => o.order_id !== order.order_id);
    list.unshift({
      order_id: order.order_id,
      service_type: order.service_type,
      package_name: order.package_name,
      amount: order.amount,
      amount_formatted: order.amount_formatted,
      status: order.status,
      created_at: new Date().toLocaleString("vi-VN")
    });
    localStorage.setItem("dth_user_orders", JSON.stringify(list.slice(0, 20)));
  } catch (e) {}
}

// 7. URL Routing with #hash (#chungsuc, #locket, #mxh, #premium, #lookup, #tools)
function initUrlRouting() {
  try {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab") || window.location.hash;
    if (tabParam) {
      const normalized = normalizeTabKey(tabParam);
      const validTabs = ["chungsuc", "locket", "mxh", "premium", "lookup", "tools"];
      if (validTabs.includes(normalized)) {
        switchTab(normalized);
      }
    }
  } catch (e) {
    console.warn("initUrlRouting searchParams error:", e);
  }

  window.addEventListener("hashchange", () => {
    try {
      const h = normalizeTabKey(window.location.hash);
      const validTabs = ["chungsuc", "locket", "mxh", "premium", "lookup", "tools"];
      if (validTabs.includes(h)) switchTab(h);
    } catch (e) {}
  });

  window.addEventListener("popstate", (e) => {
    try {
      const p = new URLSearchParams(window.location.search);
      const t = normalizeTabKey(p.get("tab") || (e.state && e.state.tab) || window.location.hash);
      const validTabs = ["chungsuc", "locket", "mxh", "premium", "lookup", "tools"];
      if (validTabs.includes(t)) switchTab(t);
    } catch (e) {}
  });
}

// 8. WakeLock API to keep screen alive during payment
let gWakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      gWakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) {}
}
function releaseWakeLock() {
  if (gWakeLock) {
    gWakeLock.release().then(() => { gWakeLock = null; }).catch(() => {});
  }
}


// ========================================================
// 9. VIETQR 1-CLICK BANKING APP OPENER
// ========================================================
function openBankingApp(appName) {
  const accNoEl = document.getElementById("payModalAccNo");
  const contentEl = document.getElementById("payModalContent");
  const amountEl = document.getElementById("payModalAmount");
  const orderId = document.getElementById("payModalOrderId")?.textContent || "";

  const accNo = accNoEl ? accNoEl.textContent.trim() : "99ZP24261M43061759";
  const content = contentEl ? contentEl.textContent.trim() : orderId;
  const rawAmtStr = amountEl ? amountEl.textContent.replace(/\D/g, "") : "0";
  const amount = parseInt(rawAmtStr, 10) || 0;
  const bankId = "970454"; // BVBank / ZaloPay

  // 1. Copy payment info to clipboard
  const copyText = `${accNo}\n${content}\n${amount}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(content).catch(() => {});
  }

  showToast(`Đã sao chép nội dung: ${content}! Đang mở app ${appName}...`, "success");

  // 2. Deep link schemas
  let appUrl = "";
  if (appName === "MBBank") {
    appUrl = "mbcustomapp://";
  } else if (appName === "Vietcombank") {
    appUrl = "vietcombank://";
  } else if (appName === "Techcombank") {
    appUrl = "techcombank://";
  } else if (appName === "ZaloPay") {
    appUrl = "zalopay://";
  } else if (appName === "MoMo") {
    appUrl = "momo://";
  }

  // Attempt opening native app
  if (appUrl) {
    const start = Date.now();
    window.location.href = appUrl;
    // Fallback if app not installed on desktop/mobile
    setTimeout(() => {
      if (Date.now() - start < 1500) {
        const vietqrWebUrl = `https://dl.vietqr.io/pay?app=${appName.toLowerCase()}&ba=${accNo}@${bankId}&am=${amount}&tn=${encodeURIComponent(content)}`;
        window.open(vietqrWebUrl, "_blank");
      }
    }, 1200);
  }
}

// ========================================================
// 10. VIP TIER SĐT/ZALO REAL-TIME CHECKER
// ========================================================
let gVipDebounceTimers = {};

function initVipTierCheckers() {
  const configs = [
    { inputId: "csZaloInput", badgeId: "csVipBadge" },
    { inputId: "locketZaloInput", badgeId: "locketVipBadge" },
    { inputId: "mxhZaloInput", badgeId: "mxhVipBadge" },
    { inputId: "premZaloInput", badgeId: "premVipBadge" }
  ];

  configs.forEach(cfg => {
    const input = document.getElementById(cfg.inputId);
    if (!input) return;
    input.addEventListener("input", () => {
      const val = input.value.trim().replace(/\D/g, "");
      clearTimeout(gVipDebounceTimers[cfg.inputId]);
      if (val.length >= 10 && val.startsWith("0")) {
        gVipDebounceTimers[cfg.inputId] = setTimeout(() => {
          checkPhoneVipTier(val, cfg.badgeId);
        }, 350);
      } else {
        const b = document.getElementById(cfg.badgeId);
        if (b) { b.style.display = "none"; b.innerHTML = ""; }
      }
    });
  });
}

async function checkPhoneVipTier(phone, badgeId) {
  const badgeEl = document.getElementById(badgeId);
  if (!badgeEl) return;

  try {
    const res = await fetch(`/api/vip/check?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (data.success && data.is_vip) {
      badgeEl.style.display = "block";
      const isGold = (data.tier === "GOLD");
      badgeEl.innerHTML = `
        <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 0.82rem; font-weight: 800; background: ${isGold ? 'rgba(245, 158, 11, 0.15)' : 'rgba(148, 163, 184, 0.2)'}; color: ${isGold ? '#b45309' : '#334155'}; border: 1px solid ${data.badge_color};">
          <i class="fa-solid fa-crown" style="color: ${data.badge_color};"></i>
          <span>Thành viên: <strong>${data.tier_label}</strong> (Ưu đãi giảm ${data.discount_percent}% tổng tiền)</span>
        </div>
      `;
      showToast(`Số điện thoại đạt hạng ${data.tier_label} (Giảm ${data.discount_percent}%)!`, "success");
    } else {
      badgeEl.style.display = "none";
    }
  } catch (e) {
    badgeEl.style.display = "none";
  }
}

// ========================================================
// 11. SMM SMART LINK & PUBLIC CHECKER
// ========================================================
let gSmmCheckTimer = null;

function initSmmSmartTools() {
  const linkInput = document.getElementById("mxhLinkInput");
  const uidBadge = document.getElementById("mxhDetectedUidBadge");
  const uidText = document.getElementById("mxhDetectedUidText");
  const publicWarn = document.getElementById("mxhPublicWarning");
  const submitBtn = document.getElementById("btnSubmitMXH");

  if (!linkInput) return;

  linkInput.addEventListener("input", () => {
    const url = linkInput.value.trim();
    clearTimeout(gSmmCheckTimer);

    if (url.length < 5) {
      if (uidBadge) uidBadge.style.display = "none";
      if (publicWarn) publicWarn.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    gSmmCheckTimer = setTimeout(async () => {
      // 1. Extract UID
      try {
        const resUid = await fetch(`/api/smm/extract-id?url=${encodeURIComponent(url)}`);
        const dataUid = await resUid.json();
        if (dataUid.success && dataUid.object_id && dataUid.object_id !== url) {
          if (uidBadge && uidText) {
            uidBadge.style.display = "block";
            uidText.textContent = `${dataUid.object_id} (${dataUid.platform || 'MXH'})`;
          }
        } else {
          if (uidBadge) uidBadge.style.display = "none";
        }
      } catch (e) {}

      // 2. Public Check
      if (url.startsWith("http://") || url.startsWith("https://")) {
        try {
          const resPub = await fetch(`/api/smm/check-public?url=${encodeURIComponent(url)}`);
          const dataPub = await resPub.json();
          if (dataPub.success && dataPub.is_public === false) {
            if (publicWarn) {
              publicWarn.style.display = "block";
              publicWarn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${dataPub.msg || 'Link này đang ở chế độ Riêng tư (Private) hoặc không tồn tại!'}`;
            }
            if (submitBtn) submitBtn.disabled = true;
          } else {
            if (publicWarn) publicWarn.style.display = "none";
            if (submitBtn) submitBtn.disabled = false;
          }
        } catch (e) {
          if (publicWarn) publicWarn.style.display = "none";
          if (submitBtn) submitBtn.disabled = false;
        }
      }
    }, 450);
  });
}

// ========================================================
// 12. AI COMMENT GENERATOR
// ========================================================
function openAiCommentsPicker() {
  const modal = document.getElementById("aiCommentModal");
  if (modal) modal.style.display = "flex";
}

function closeAiCommentsModal() {
  const modal = document.getElementById("aiCommentModal");
  if (modal) modal.style.display = "none";
}

async function generateAiComments() {
  const topic = document.getElementById("aiCommentTopic")?.value || "ban_hang";
  const tone = document.getElementById("aiCommentTone")?.value || "tu_nhien";
  const count = document.getElementById("aiCommentCount")?.value || "15";

  const previewBox = document.getElementById("aiCommentPreviewBox");
  const previewText = document.getElementById("aiCommentPreviewText");
  const btnApply = document.getElementById("btnApplyAiComments");

  try {
    const res = await fetch(`/api/smm/generate-comments?topic=${encodeURIComponent(topic)}&tone=${encodeURIComponent(tone)}&count=${encodeURIComponent(count)}`);
    const data = await res.json();
    if (data.success && data.comments) {
      if (previewBox && previewText) {
        previewBox.style.display = "block";
        previewText.value = data.comments.join("\n");
      }
      if (btnApply) btnApply.style.display = "block";
      showToast(`Đã sinh thành công ${data.comments.length} bình luận tự nhiên!`, "success");
    }
  } catch (e) {
    showToast("Lỗi sinh bình luận: " + e.message, "error");
  }
}

function applyAiCommentsToOrder() {
  const previewText = document.getElementById("aiCommentPreviewText");
  const commentsInput = document.getElementById("mxhCommentsInput");
  const commentCountEl = document.getElementById("mxhCommentCount");
  const qtyInput = document.getElementById("mxhQtyInput");

  if (previewText && commentsInput) {
    const val = previewText.value.trim();
    commentsInput.value = val;
    const lines = val ? val.split("\n").filter(l => l.trim().length > 0) : [];
    if (commentCountEl) commentCountEl.textContent = lines.length;
    if (qtyInput && lines.length > 0) {
      qtyInput.value = Math.max(lines.length, parseInt(qtyInput.value, 10) || lines.length);
      calculateMxhPrice();
    }
    closeAiCommentsModal();
    showToast(`Đã điền ${lines.length} bình luận vào đơn hàng!`, "success");
  }
}

function copyHashtags(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Đã sao chép bộ Hashtag vào bộ nhớ tạm!", "success");
  }).catch(() => {
    showToast("Đã sao chép: " + text, "success");
  });
}

// ========================================================
// 13. FREE CREATOR TOOLS HANDLERS
// ========================================================
function initFreeTools() {
  // Free tools are initialized when user clicks tool tabs
}

function switchFreeToolTab(tool) {
  const panes = {
    uid: document.getElementById("toolPaneUid"),
    tiktok: document.getElementById("toolPaneTiktok"),
    qr: document.getElementById("toolPaneQr")
  };

  const btns = document.querySelectorAll(".btn-tool-tab");
  btns.forEach(b => {
    const isAct = b.dataset.tool === tool;
    b.classList.toggle("active", isAct);
    b.style.background = isAct ? "var(--blue-primary)" : "#f8fafc";
    b.style.color = isAct ? "#ffffff" : "#475569";
    b.style.borderColor = isAct ? "var(--border-blue)" : "#cbd5e1";
  });

  Object.keys(panes).forEach(k => {
    if (panes[k]) panes[k].style.display = (k === tool) ? "block" : "none";
  });
}

async function handleGetUID(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById("toolUidInput");
  const val = input ? input.value.trim() : "";
  if (!val) return;

  const resBox = document.getElementById("toolUidResult");
  const valEl = document.getElementById("toolUidVal");
  const metaEl = document.getElementById("toolUidMeta");
  const btn = document.getElementById("btnToolGetUid");

  if (resBox) {
    resBox.hidden = true;
    resBox.classList.add("hidden");
    resBox.style.display = "none";
  }
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/smm/extract-id?url=${encodeURIComponent(val)}`);
    const data = await res.json();
    if (data.success && data.object_id) {
      if (resBox && valEl && metaEl) {
        resBox.hidden = false;
        resBox.classList.remove("hidden");
        resBox.style.display = "block";
        valEl.textContent = data.object_id;
        metaEl.textContent = `Nền tảng: ${data.platform ? data.platform.toUpperCase() : 'MXH'} • Loại: ${data.type || 'Object ID'}`;
      }
      showToast("Đã trích xuất UID thành công!", "success");
    } else {
      if (resBox) {
        resBox.hidden = true;
        resBox.classList.add("hidden");
        resBox.style.display = "none";
      }
      showToast("Không bóc tách được UID từ link này.", "error");
    }
  } catch (err) {
    if (resBox) {
      resBox.hidden = true;
      resBox.classList.add("hidden");
      resBox.style.display = "none";
    }
    showToast("Lỗi kết nối: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function copyToolUidResult() {
  const valEl = document.getElementById("toolUidVal");
  if (!valEl) return;
  const txt = valEl.textContent.trim();
  navigator.clipboard.writeText(txt).then(() => {
    showToast("Đã sao chép UID: " + txt, "success");
  });
}


// ==========================================
// MEDIA BLOB DOWNLOAD HELPER (NO TAB OPEN)
// ==========================================
async function downloadMediaBlob(url, filename) {
  if (!url) {
    showToast("Không tìm thấy liên kết tệp để tải về.", "error");
    return;
  }
  showToast("Đang chuẩn bị tải tệp về máy...", "info");
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    showToast("Đã tải tệp về máy thành công!", "success");
  } catch (err) {
    console.warn("Lỗi tải Blob trực tiếp (do CORS), chuyển sang mở tải trực tiếp:", err);
    window.open(url, "_blank");
  }
}

async function handleGetTikTokNoWatermark(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById("toolTiktokInput");
  const val = input ? input.value.trim() : "";
  if (!val) return;

  const loading = document.getElementById("toolTiktokLoading");
  const result = document.getElementById("toolTiktokResult");
  const cover = document.getElementById("toolTiktokCover");
  const title = document.getElementById("toolTiktokTitle");
  const author = document.getElementById("toolTiktokAuthor");
  const btn = document.getElementById("btnToolGetTiktok");

  if (loading) {
    loading.hidden = false;
    loading.classList.remove("hidden");
    loading.style.display = "block";
  }
  if (result) {
    result.hidden = true;
    result.classList.add("hidden");
    result.style.display = "none";
  }
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/tools/tiktok-download?url=${encodeURIComponent(val)}`);
    const data = await res.json();
    if (data.success) {
      if (cover) cover.src = data.cover || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
      if (title) title.textContent = data.title || "Video TikTok";
      if (author) author.textContent = `@${data.author || "creator"}`;

      const btnDlVideo = document.getElementById("btn-download-video");
      const btnDlAudio = document.getElementById("btn-download-audio");

      if (btnDlVideo) {
        btnDlVideo.onclick = (ev) => {
          if (ev) ev.preventDefault();
          downloadMediaBlob(data.video_url, "tiktok_no_watermark.mp4");
        };
      }
      if (btnDlAudio) {
        if (data.music_url) {
          btnDlAudio.style.display = "inline-flex";
          btnDlAudio.onclick = (ev) => {
            if (ev) ev.preventDefault();
            downloadMediaBlob(data.music_url, "tiktok_audio.mp3");
          };
        } else {
          btnDlAudio.style.display = "none";
        }
      }
      if (result) {
        result.hidden = false;
        result.classList.remove("hidden");
        result.style.display = "block";
      }
      showToast("Đã lấy video không logo thành công!", "success");
    } else {
      if (result) {
        result.hidden = true;
        result.classList.add("hidden");
        result.style.display = "none";
      }
      showToast(data.msg || "Không thể tải video từ link này.", "error");
    }
  } catch (err) {
    if (result) {
      result.hidden = true;
      result.classList.add("hidden");
      result.style.display = "none";
    }
    showToast("Lỗi tải video: " + err.message, "error");
  } finally {
    if (loading) {
      loading.hidden = true;
      loading.classList.add("hidden");
      loading.style.display = "none";
    }
    if (btn) btn.disabled = false;
  }
}

function handleGenerateQR(e) {
  if (e && e.preventDefault) e.preventDefault();
  const content = document.getElementById("toolQrContent")?.value.trim() || "";
  const color = document.getElementById("toolQrColor")?.value || "#0f172a";
  const bgcolor = document.getElementById("toolQrBgColor")?.value || "#ffffff";

  if (!content) return;

  const cleanColor = color.replace("#", "");
  const cleanBg = bgcolor.replace("#", "");
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&color=${cleanColor}&bgcolor=${cleanBg}&data=${encodeURIComponent(content)}`;

  const resBox = document.getElementById("toolQrResult");
  const img = document.getElementById("toolQrImg");

  if (img) img.src = qrUrl;
  if (resBox) resBox.style.display = "block";
  showToast("Đã tạo mã QR thành công!", "success");
}

function downloadQRImage() {
  const img = document.getElementById("toolQrImg");
  if (!img || !img.src) return;
  fetch(img.src)
    .then(r => r.blob())
    .then(blob => {
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = "custom_qr_code.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u);
      showToast("Đã tải mã QR về máy!", "success");
    })
    .catch(() => {
      window.open(img.src, "_blank");
    });
}

// ========================================================
// 14. AUTO INIT HOOK (Safe Fault-Tolerant)
// ========================================================
function initSecondaryHooks() {
  try { initVipTierCheckers(); } catch (e) {}
  try { initSmmSmartTools(); } catch (e) {}
  try { initFreeTools(); } catch (e) {}
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSecondaryHooks);
} else {
  initSecondaryHooks();
}

// Tự động kiểm tra và cập nhật thời gian đếm ngược khi quay lại Safari từ App Ngân Hàng
function recheckPaymentOnForeground() {
  if (gPaymentEndTime) {
    const display = document.getElementById("payModalCountdown");
    const diff = Math.max(0, Math.floor((gPaymentEndTime - Date.now()) / 1000));
    let minutes = parseInt(diff / 60, 10);
    let seconds = parseInt(diff % 60, 10);
    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;
    if (display) display.textContent = diff > 0 ? (minutes + ":" + seconds) : "HẾT HẠN";
  }
  const pending = (typeof gCurrentOrder !== "undefined" && gCurrentOrder && gCurrentOrder.order_id)
    ? gCurrentOrder
    : (typeof getSavedPendingOrder === "function" ? getSavedPendingOrder() : null);
  if (pending && pending.order_id) {
    fetch(`/api/payment/check/${pending.order_id}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.success && data.status && data.status !== "PENDING") {
          if (gPayPollTimer) { clearInterval(gPayPollTimer); gPayPollTimer = null; }
          handlePaymentSuccess(data.order || { order_id: pending.order_id, status: data.status });
        }
      })
      .catch(() => {});
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    recheckPaymentOnForeground();
  }
});
window.addEventListener("focus", () => {
  recheckPaymentOnForeground();
});


// ========================================================
// 15. POPUP ANNOUNCEMENT MODAL SYSTEM (TECH-CUTE CYBER-KAWAII)
// ========================================================
let gAnnouncementData = null;
let gAnnouncementCheckPromise = null;

async function checkAndShowAnnouncement() {
  if (gAnnouncementCheckPromise) return gAnnouncementCheckPromise;

  gAnnouncementCheckPromise = (async () => {
    try {
      const res = await fetch("/api/announcement", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.success) return;

      const ann = data.data || data;
      if (!ann.enabled || !ann.content || !ann.content.trim()) return;

      gAnnouncementData = ann;

      const lastSeenTs = sessionStorage.getItem("dth_announcement_seen_ts");
      if (lastSeenTs && parseInt(lastSeenTs, 10) >= (ann.updated_at || 0)) {
        return;
      }

      const modal = document.getElementById("popupAnnouncementModal");
      const titleEl = document.getElementById("announcementModalTitle");
      const contentEl = document.getElementById("announcementModalContent");

      if (modal && titleEl && contentEl) {
        titleEl.textContent = ann.title || "🎉 THÔNG BÁO TỪ HỆ THỐNG";
        contentEl.textContent = ann.content || "";
        modal.style.display = "flex";
      }
    } catch (err) {
      console.debug("[Announcement] Check error:", err);
    } finally {
      gAnnouncementCheckPromise = null;
    }
  })();

  return gAnnouncementCheckPromise;
}

function closePopupAnnouncement() {
  const modal = document.getElementById("popupAnnouncementModal");
  if (modal) {
    modal.style.display = "none";
  }
  if (gAnnouncementData && gAnnouncementData.updated_at) {
    sessionStorage.setItem("dth_announcement_seen_ts", String(gAnnouncementData.updated_at));
  } else {
    sessionStorage.setItem("dth_announcement_seen_ts", String(Date.now()));
  }
}

window.checkAndShowAnnouncement = checkAndShowAnnouncement;
window.closePopupAnnouncement = closePopupAnnouncement;
