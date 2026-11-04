/**

 * DTH Portal - Unified Admin JavaScript

 * Powers Dashboard stats, Orders management, and settings for Chung Sá»©c, Locket Gold, MXH, Banking & Telegram.

 */



let gAdminConfig = {};

let gOrdersList = [];
let gAdminExpiryTimer = null;
let gAdminRedirecting = false;

const originalAdminFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalAdminFetch(...args);
  const requestUrl = args[0] instanceof Request ? args[0].url : args[0];
  const pathname = new URL(requestUrl, window.location.href).pathname;
  if ((response.status === 401 || response.status === 403) &&
      pathname.startsWith("/api/") &&
      pathname !== "/api/admin/login") {
    redirectToAdminLogin();
  }
  return response;
};



document.addEventListener("DOMContentLoaded", () => {

  checkAuth();

  initSidebarTabs();

  initMobileNav();

  initDashboard();

  initOrders();

  initChungSucAdmin();

  initLocketAdmin();

  initMxhAdmin();

  initAdminMxhServices();

  initPaymentAdmin();

  initSettingsAdmin();
  initAnnouncementAdmin();

});



// ==========================================

// AUTHENTICATION

// ==========================================

async function checkAuth() {
  try {
    const res = await fetch("/api/admin/check-auth");
    const data = await res.json();
    if (!res.ok || !data.is_admin) {
      redirectToAdminLogin();
      return;
    }
    if (gAdminExpiryTimer) clearTimeout(gAdminExpiryTimer);
    const expiresIn = Math.max(0, data.expires_at * 1000 - Date.now());
    gAdminExpiryTimer = setTimeout(redirectToAdminLogin, expiresIn);
    const logoutButton = document.getElementById("btnAdminLogout");
    if (logoutButton) logoutButton.addEventListener("click", async () => {
      await fetch("/api/admin/logout", { method: "POST" });
      window.location.replace("/admin");
    });
    loadInitialData();
  } catch (e) {
    console.error("Auth check failed:", e);
  }
}

function redirectToAdminLogin() {
  if (gAdminRedirecting) return;
  gAdminRedirecting = true;
  if (gAdminExpiryTimer) clearTimeout(gAdminExpiryTimer);
  window.location.replace("/admin");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}


function loadInitialData() {

  loadStats();

  loadOrders();

  loadFullConfig();
  checkPartnerBalance("autonhanh");
  checkPartnerBalance("tangtim");

}

async function checkPartnerBalance(partner) {
  const isAutoNhanh = partner === "autonhanh";
  const element = document.getElementById(isAutoNhanh ? "balAutoNhanh" : "balTangTim");
  if (!element) return;

  element.classList.remove("text-danger");
  element.style.color = "";
  element.textContent = "Đang kiểm tra...";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const endpoint = isAutoNhanh ? "/api/admin/autonhanh/balance" : "/api/admin/tangtim/balance";
    const response = await fetch(endpoint, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.msg || "Lỗi kết nối / Chưa cấu hình API");
    }

    element.textContent = isAutoNhanh
      ? `${Number(data.balance).toLocaleString("vi-VN")} Xu`
      : (data.balance_formatted || `${Number(data.balance_vnd).toLocaleString("vi-VN")}đ`);
  } catch (error) {
    element.classList.add("text-danger");
    element.style.color = "#ef4444";
    element.textContent = "Chưa kết nối API";
  } finally {
    clearTimeout(timeoutId);
  }
}


// ==========================================

// SIDEBAR TABS

// ==========================================

function switchToTab(target) {

  const tabs = document.querySelectorAll(".sidebar-tab");

  const panels = document.querySelectorAll(".admin-panel");

  const titleElem = document.getElementById("adminPageTitle");



  const titles = {

    dashboard: "Báº£ng Äiá»u Khiá»ƒn Tá»•ng Quan",

    "orders-chungsuc": "Quáº£n LÃ½ ÄÆ¡n Chung Sá»©c LiÃªn QuÃ¢n (AutoNhanh)",

    "orders-locket": "Quáº£n LÃ½ ÄÆ¡n NÃ¢ng Cáº¥p Locket Gold iOS",

    "orders-mxh": "Quáº£n LÃ½ ÄÆ¡n Máº¡ng XÃ£ Há»™i (TangTim API)",

    "orders-premium": "Quáº£n LÃ½ ÄÆ¡n Chá»£ Premium (YouTube, Spotify, Netflix)",

    premium: "CÃ i Äáº·t Báº£ng GiÃ¡ Chá»£ Premium",

    chungsuc: "CÃ i Äáº·t Sá»± Kiá»‡n Chung Sá»©c LiÃªn QuÃ¢n",

    locket: "CÃ i Äáº·t & Quáº£n LÃ½ Locket Gold",

    mxh: "CÃ i Äáº·t Dá»‹ch Vá»¥ Máº¡ng XÃ£ Há»™i (TangTim)",

    payment: "CÃ i Äáº·t NgÃ¢n HÃ ng & Auto QuÃ©t ThueAPIBank",

    announcement: "Quản Lý Popup Thông Báo Khách Hàng",
    popup: "Quản Lý Popup Thông Báo Khách Hàng",
    "popup-announcement": "Quản Lý Popup Thông Báo Khách Hàng",
    "popup-thong-bao": "Quản Lý Popup Thông Báo Khách Hàng",
    settings: "CÃ i Äáº·t Há»‡ Thá»‘ng, Telegram & GitHub"

  };



  const isAnnouncement = target === "announcement" || target === "popup" || target === "popup-announcement" || target === "popup-thong-bao";

  tabs.forEach(t => {
    const tabTarget = t.dataset.tab;
    const isTabMatched = (isAnnouncement && (tabTarget === "announcement" || tabTarget === "popup" || tabTarget === "popup-announcement" || tabTarget === "popup-thong-bao")) || (tabTarget === target);
    t.classList.toggle("active", isTabMatched);
  });

  const targetPanelId = isAnnouncement ? "panel-announcement" : `panel-${target}`;
  panels.forEach(p => {
    const isPanelMatched = (isAnnouncement && (p.id === "panel-announcement" || p.id === "admin-popup-panel" || p.classList.contains("admin-popup-panel") || p.getAttribute("data-tab-panel") === "admin-popup-panel")) || (p.id === targetPanelId);
    p.classList.toggle("active", isPanelMatched);
    if (isPanelMatched) {
      p.classList.add("show");
      p.classList.remove("hidden");
      p.style.display = "block";
    } else {
      p.classList.remove("show");
      p.style.display = "none";
    }
  });

  if (isAnnouncement) {
    if (typeof loadPopupConfig === "function") {
      loadPopupConfig();
    } else if (typeof loadPopupAnnouncement === "function") {
      loadPopupAnnouncement();
    }
  }



  if (titleElem) {

    titleElem.textContent = titles[target] || "Quáº£n Trá»‹ Há»‡ Thá»‘ng";

  }



  // Update top sub-nav order tabs active state

  document.querySelectorAll(".btn-orders-tab").forEach(btn => {

    const isMatched = (target === "orders-chungsuc" && btn.getAttribute("onclick")?.includes("orders-chungsuc")) ||

                      (target === "orders-locket" && btn.getAttribute("onclick")?.includes("orders-locket")) ||

                      (target === "orders-mxh" && btn.getAttribute("onclick")?.includes("orders-mxh")) ||

                      (target === "orders-premium" && btn.getAttribute("onclick")?.includes("orders-premium"));

    btn.classList.toggle("active", isMatched);

  });



  // Update mobile bottom nav active state

  document.querySelectorAll(".admin-mobile-nav-btn").forEach(btn => {

    btn.classList.toggle("active", btn.dataset.tab === target);

  });



  // Close mobile sidebar if open

  closeMobileSidebar();



  if (target.startsWith("orders")) loadOrders();

  if (target === "dashboard") loadStats();

  if (target === "locket") loadLocketTokens();

  if (target === "mxh") loadAdminMxhServices();

  if (target === "premium") loadPremiumAdmin();

}



function initSidebarTabs() {

  const tabs = document.querySelectorAll(".sidebar-tab");

  tabs.forEach(tab => {

    tab.addEventListener("click", () => {

      const target = tab.dataset.tab;

      switchToTab(target);

    });

  });

}



// ==========================================

// 1. DASHBOARD STATS

// ==========================================

function initDashboard() {

  document.getElementById("btnTopScanBank").addEventListener("click", triggerBankScan);

}



async function loadStats() {

  try {

    const res = await fetch("/api/admin/stats");

    const data = await res.json();

    if (!data.success) return;



    document.getElementById("statTotalRev").textContent = data.total_revenue_formatted || "0Ä‘";

    document.getElementById("statTodayRev").textContent = data.today_revenue_formatted || "0Ä‘";

    document.getElementById("statTotalOrders").textContent = data.counts.all || 0;

    document.getElementById("statPendingOrders").textContent = data.status_counts.PENDING || 0;



    // Service Breakdown

    document.getElementById("bdCsOrders").textContent = `${data.counts.chungsuc || 0} Ä‘Æ¡n`;

    document.getElementById("bdCsRev").textContent = (data.rev_by_type.chungsuc || 0).toLocaleString("vi-VN") + "Ä‘";



    document.getElementById("bdLkOrders").textContent = `${data.counts.locket || 0} Ä‘Æ¡n`;

    document.getElementById("bdLkRev").textContent = (data.rev_by_type.locket || 0).toLocaleString("vi-VN") + "Ä‘";



    document.getElementById("bdMxhOrders").textContent = `${data.counts.mxh || 0} Ä‘Æ¡n`;

    document.getElementById("bdMxhRev").textContent = (data.rev_by_type.mxh || 0).toLocaleString("vi-VN") + "Ä‘";



    const bdPrOrders = document.getElementById("bdPrOrders");

    const bdPrRev = document.getElementById("bdPrRev");

    if (bdPrOrders) bdPrOrders.textContent = `${data.counts.premium || 0} Ä‘Æ¡n`;

    if (bdPrRev) bdPrRev.textContent = (data.rev_by_type.premium || 0).toLocaleString("vi-VN") + "Ä‘";



  } catch (e) {

    console.error("Error loading stats:", e);

  }

}



async function triggerBankScan() {

  const btn = document.getElementById("btnTopScanBank");

  btn.disabled = true;

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang quÃ©t...`;



  try {

    const res = await fetch("/api/admin/check-bank", { method: "POST" });

    const data = await res.json();

    if (data.matched && data.matched.length > 0) {

      showToast(`ðŸŽ‰ Khá»›p thÃ nh cÃ´ng ${data.matched.length} Ä‘Æ¡n hÃ ng: ${data.matched.join(", ")}`, "success");

      loadOrders();

      loadStats();

    } else {

      showToast(data.msg || "ÄÃ£ quÃ©t ngÃ¢n hÃ ng. KhÃ´ng cÃ³ giao dá»‹ch má»›i khá»›p.", "info");

    }

  } catch (e) {

    showToast("Lá»—i quÃ©t ngÃ¢n hÃ ng: " + e.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = `<i class="fa-solid fa-rotate"></i> <span>QuÃ©t NgÃ¢n HÃ ng Ngay</span>`;

  }

}



// ==========================================

// 2. SEPARATED ORDERS MANAGEMENT (CS, LOCKET, MXH)

// ==========================================

function initOrders() {

  // Chung Suc listeners

  const filterCs = document.getElementById("filterCsStatus");

  if (filterCs) filterCs.addEventListener("change", () => loadOrders("chungsuc", true));

  const searchCs = document.getElementById("searchCsInput");

  if (searchCs) searchCs.addEventListener("input", debounce(() => loadOrders("chungsuc", true), 300));

  const refreshCs = document.getElementById("btnRefreshCsOrders");

  if (refreshCs) refreshCs.addEventListener("click", () => loadOrders("chungsuc", true));



  // Locket listeners

  const filterLk = document.getElementById("filterLkStatus");

  if (filterLk) filterLk.addEventListener("change", () => loadOrders("locket", true));

  const searchLk = document.getElementById("searchLkInput");

  if (searchLk) searchLk.addEventListener("input", debounce(() => loadOrders("locket", true), 300));

  const refreshLk = document.getElementById("btnRefreshLkOrders");

  if (refreshLk) refreshLk.addEventListener("click", () => loadOrders("locket", true));



  // MXH listeners

  const filterMxhPlat = document.getElementById("filterMxhPlatform");

  if (filterMxhPlat) filterMxhPlat.addEventListener("change", () => loadOrders("mxh", true));

  const filterMxhSt = document.getElementById("filterMxhStatus");

  if (filterMxhSt) filterMxhSt.addEventListener("change", () => loadOrders("mxh", true));

  const searchMxh = document.getElementById("searchMxhInput");

  if (searchMxh) searchMxh.addEventListener("input", debounce(() => loadOrders("mxh", true), 300));

  const refreshMxh = document.getElementById("btnRefreshMxhOrders");

  if (refreshMxh) refreshMxh.addEventListener("click", () => loadOrders("mxh", true));



  // Premium listeners

  const filterPrPlat = document.getElementById("filterPrPlatform");

  if (filterPrPlat) filterPrPlat.addEventListener("change", () => loadOrders("premium", true));

  const filterPrSt = document.getElementById("filterPrStatus");

  if (filterPrSt) filterPrSt.addEventListener("change", () => loadOrders("premium", true));

  const searchPr = document.getElementById("searchPrInput");

  if (searchPr) searchPr.addEventListener("input", debounce(() => loadOrders("premium", true), 300));

  const refreshPr = document.getElementById("btnRefreshPrOrders");

  if (refreshPr) refreshPr.addEventListener("click", () => loadOrders("premium", true));

}

function setOrdersTableMessage(scope, message) {
  const tableIds = {
    chungsuc: "csOrdersTableBody",
    locket: "lkOrdersTableBody",
    mxh: "mxhOrdersTableBody",
    premium: "tbodyOrdersPremium"
  };
  const scopes = scope ? [scope] : Object.keys(tableIds);
  scopes.forEach(key => {
    const tbody = document.getElementById(tableIds[key]);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center">${message}</td></tr>`;
  });
}


function copyToClipboard(text, msg) {

  navigator.clipboard.writeText(text).then(() => {

    showToast(msg || "ÄÃ£ sao chÃ©p vÃ o bá»™ nhá»› táº¡m!", "success");

  }).catch(() => {

    showToast("KhÃ´ng thá»ƒ sao chÃ©p!", "error");

  });

}



// ==========================================

// VERCEL PERSISTENCE: LOCAL DELETED ORDERS STORE

// ==========================================

function getAdminDeletedOrders() {

  try {

    const raw = localStorage.getItem("dth_admin_deleted_orders");

    if (raw) return new Set(JSON.parse(raw));

  } catch (e) {}

  return new Set();

}



function addAdminDeletedOrder(oid) {

  if (!oid) return;

  const s = getAdminDeletedOrders();

  s.add(String(oid).toUpperCase());

  try {

    localStorage.setItem("dth_admin_deleted_orders", JSON.stringify(Array.from(s)));

  } catch (e) {}

}



async function loadOrders(targetScope = null, forceSync = false) {

  setOrdersTableMessage(targetScope, '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách đơn hàng...');

  try {

    if (forceSync) {

      try {

        await fetchWithTimeout("/api/admin/orders/sync-all?t=" + Date.now());

      } catch (e) {}

    }

    const res = await fetchWithTimeout("/api/admin/orders?service=all&status=all&t=" + Date.now());

    const data = await res.json();

    if (!res.ok || !data.success) {
      setOrdersTableMessage(targetScope, "Không thể tải đơn hàng. Vui lòng thử lại.");
      return;
    }



    const deletedSet = getAdminDeletedOrders();

    const allOrders = (data.orders || []).filter(o => !deletedSet.has(String(o.order_id || "").toUpperCase()));

    gOrdersList = allOrders;



    // PhÃ¢n loáº¡i riÃªng tá»«ng dá»‹ch vá»¥

    const csAll = [];

    const lkAll = [];

    const mxhAll = [];

    const prAll = [];



    allOrders.forEach(o => {

      const oid = String(o.order_id || "");

      const stype = o.service_type || (oid.startsWith("CS") ? "chungsuc" : (oid.startsWith("LK") ? "locket" : (oid.startsWith("PR") ? "premium" : "mxh")));

      if (stype === "chungsuc") csAll.push(o);

      else if (stype === "locket") lkAll.push(o);

      else if (stype === "premium") prAll.push(o);

      else mxhAll.push(o);

    });



    // Cáº­p nháº­t sá»‘ lÆ°á»£ng huy hiá»‡u trÃªn Sidebar & Nav Tabs

    const setBadge = (id, count) => {

      const el = document.getElementById(id);

      if (el) el.textContent = count;

    };



    setBadge("badgeCountCs", csAll.length);

    setBadge("badgeCountLk", lkAll.length);

    setBadge("badgeCountMxh", mxhAll.length);



    setBadge("tabBadgeCs", csAll.length);

    setBadge("tabBadgeCs2", csAll.length);

    setBadge("tabBadgeCs3", csAll.length);



    setBadge("tabBadgeLk", lkAll.length);

    setBadge("tabBadgeLk2", lkAll.length);

    setBadge("tabBadgeLk3", lkAll.length);



    setBadge("tabBadgeMxh", mxhAll.length);

    setBadge("tabBadgeMxh2", mxhAll.length);

    setBadge("tabBadgeMxh3", mxhAll.length);

    setBadge("tabBadgeMxh4", mxhAll.length);



    setBadge("badgeCountPr", prAll.length);

    setBadge("tabBadgePr", prAll.length);

    setBadge("tabBadgePr2", prAll.length);

    setBadge("tabBadgePr3", prAll.length);

    setBadge("tabBadgePr4", prAll.length);



    // 1. Render Báº£ng Chung Sá»©c LiÃªn QuÃ¢n

    if (!targetScope || targetScope === "chungsuc") {

      const csStatus = (document.getElementById("filterCsStatus")?.value || "all").toUpperCase();

      const csQuery = (document.getElementById("searchCsInput")?.value || "").trim().toLowerCase();



      let filteredCs = csAll.filter(o => {

        if (csStatus !== "ALL" && (o.status || "").toUpperCase() !== csStatus) return false;

        if (csQuery) {

          const matchStr = `${o.order_id} ${o.code || ""} ${o.zalo || ""} ${o.package_name || ""}`.toLowerCase();

          if (!matchStr.includes(csQuery)) return false;

        }

        return true;

      });

      renderCsOrdersTable(filteredCs);

    }



    // 2. Render Báº£ng Locket Gold

    if (!targetScope || targetScope === "locket") {

      const lkStatus = (document.getElementById("filterLkStatus")?.value || "all").toUpperCase();

      const lkQuery = (document.getElementById("searchLkInput")?.value || "").trim().toLowerCase();



      let filteredLk = lkAll.filter(o => {

        if (lkStatus !== "ALL" && (o.status || "").toUpperCase() !== lkStatus) return false;

        if (lkQuery) {

          const matchStr = `${o.order_id} ${o.username || ""} ${o.uid || ""} ${o.zalo || ""} ${o.package_name || ""}`.toLowerCase();

          if (!matchStr.includes(lkQuery)) return false;

        }

        return true;

      });

      renderLkOrdersTable(filteredLk);

    }



    // 3. Render Báº£ng Máº¡ng XÃ£ Há»™i

    if (!targetScope || targetScope === "mxh") {

      const mxhPlat = (document.getElementById("filterMxhPlatform")?.value || "all").toLowerCase();

      const mxhStatus = (document.getElementById("filterMxhStatus")?.value || "all").toUpperCase();

      const mxhQuery = (document.getElementById("searchMxhInput")?.value || "").trim().toLowerCase();



      let filteredMxh = mxhAll.filter(o => {

        if (mxhPlat !== "all") {

          const p = (o.platform || o.category_code || "").toLowerCase();

          if (!p.includes(mxhPlat)) return false;

        }

        if (mxhStatus !== "ALL" && (o.status || "").toUpperCase() !== mxhStatus) return false;

        if (mxhQuery) {

          const matchStr = `${o.order_id} ${o.link || ""} ${o.zalo || ""} ${o.package_name || ""} ${o.service_name || ""}`.toLowerCase();

          if (!matchStr.includes(mxhQuery)) return false;

        }

        return true;

      });

      renderMxhOrdersTable(filteredMxh);

    }



    // 4. Render Báº£ng Chá»£ Premium

    if (!targetScope || targetScope === "premium") {

      const prPlat = (document.getElementById("filterPrPlatform")?.value || "all").toLowerCase();

      const prStatus = (document.getElementById("filterStatusPremium")?.value || document.getElementById("filterPrStatus")?.value || "all").toUpperCase();

      const prQuery = (document.getElementById("searchOrdersPremium")?.value || document.getElementById("searchPrInput")?.value || "").trim().toLowerCase();



      let filteredPr = prAll.filter(o => {

        if (prPlat !== "all" && (o.platform || "").toLowerCase() !== prPlat) return false;

        if (prStatus !== "ALL" && (o.status || "").toUpperCase() !== prStatus) return false;

        if (prQuery) {

          const matchStr = `${o.order_id} ${o.target || ""} ${o.zalo || ""} ${o.package_name || ""} ${o.platform_name || ""}`.toLowerCase();

          if (!matchStr.includes(prQuery)) return false;

        }

        return true;

      });

      renderPremiumOrdersTable(filteredPr);

    }



  } catch (e) {

    console.error("Error loading separated orders:", e);
    setOrdersTableMessage(targetScope, "Không thể tải đơn hàng. Vui lòng thử lại.");

  }

}



// Báº£ng 1: Chung Sá»©c LiÃªn QuÃ¢n

function renderCsOrdersTable(orders) {

  const tbody = document.getElementById("csOrdersTableBody");

  if (!tbody) return;

  tbody.innerHTML = "";



  if (orders.length === 0) {

    tbody.innerHTML = `<tr><td colspan="9" class="text-center">Không có đơn hàng nào</td></tr>`;

    return;

  }



  orders.forEach(o => {

    const tr = document.createElement("tr");

    const st = (o.status || "PENDING").toUpperCase();

    let statusClass = "status-pending";

    if (st === "COMPLETED") statusClass = "status-completed";

    if (st === "PROCESSING" || st === "PAID") statusClass = "status-processing";

    if (st === "FAILED") statusClass = "status-failed";



    let partnerLog = "-";

    if (o.autonhanh_batch_id) partnerLog = `<span class="text-cyan">AutoNhanh #${o.autonhanh_batch_id}</span>`;

    if (o.autonhanh_error) partnerLog += `<br><small class="text-danger">${o.autonhanh_error}</small>`;



    const code = o.code || "";

    const codeDisplay = code

      ? `<code style="color: #facc15;">${code}</code> <button class="code-copy-btn" onclick="copyToClipboard('${code}', 'ÄÃ£ copy mÃ£ LQ!')"><i class="fa-solid fa-copy"></i></button>`

      : '<span class="text-dim">KhÃ´ng cÃ³</span>';



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="MÃ£ ÄÆ¡n"><strong>#${o.order_id}</strong></td>

      <td data-label="MÃ£ Má»i">${codeDisplay}</td>

      <td data-label="GÃ³i ÄÆ¡n"><strong>${o.package_name || "Buff LÆ°á»£t LQ"}</strong></td>

      <td data-label="Sá»‘ Zalo"><code>${o.zalo || "N/A"}</code></td>

      <td data-label="Sá»‘ Tiá»n"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "Ä‘")}</strong></td>

      <td data-label="Tráº¡ng ThÃ¡i"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thá»i Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="Tiáº¿n Äá»™"><small>${partnerLog}</small></td>

      <td data-label="Thao TÃ¡c">

        <div class="action-buttons-cell">

          ${st === "PENDING" ? `<button class="btn-sm btn-accept" onclick="acceptOrder('${o.order_id}')" title="Duyá»‡t & Äáº©y"><i class="fa-solid fa-check"></i> Duyá»‡t</button>` : ""}

          <button class="btn-sm btn-edit" onclick="adminEditTarget('${o.order_id}', '${code}', 'code')" title="Sá»­a mÃ£ má»i"><i class="fa-solid fa-pen"></i> Sá»­a</button>

          <button class="btn-sm btn-push" onclick="pushOrder('${o.order_id}')" title="Äáº©y láº¡i"><i class="fa-solid fa-paper-plane"></i> Äáº©y</button>

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="HoÃ n thÃ nh"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="XÃ³a Ä‘Æ¡n"><i class="fa-solid fa-trash"></i> XÃ³a</button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



// Báº£ng 2: Locket Gold

function renderLkOrdersTable(orders) {

  const tbody = document.getElementById("lkOrdersTableBody");

  if (!tbody) return;

  tbody.innerHTML = "";



  if (orders.length === 0) {

    tbody.innerHTML = `<tr><td colspan="9" class="text-center">Không có đơn hàng nào</td></tr>`;

    return;

  }



  orders.forEach(o => {

    const tr = document.createElement("tr");

    const st = (o.status || "PENDING").toUpperCase();

    let statusClass = "status-pending";

    if (st === "COMPLETED") statusClass = "status-completed";

    if (st === "PROCESSING" || st === "PAID") statusClass = "status-processing";

    if (st === "FAILED") statusClass = "status-failed";



    const user = o.username || "";

    const avatar = o.profile_picture_url || "https://play-lh.googleusercontent.com/eRZLg00mAQGayCrFjDBklPIpW3qFHcmUs8PUQA4z7hVe-cDKMcRqecVHONAIexJGJZM";



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="MÃ£ ÄÆ¡n"><strong>#${o.order_id}</strong></td>

      <td data-label="KhÃ¡ch HÃ ng">

        <div style="display: flex; align-items: center; gap: 8px;">

          <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1.5px solid #ec4899;" onerror="this.src='https://play-lh.googleusercontent.com/eRZLg00mAQGayCrFjDBklPIpW3qFHcmUs8PUQA4z7hVe-cDKMcRqecVHONAIexJGJZM'">

          <div>

            <strong style="color: #f472b6;">@${user || "N/A"}</strong>

            ${o.display_name ? `<br><small class="text-dim">${o.display_name}</small>` : ""}

          </div>

        </div>

      </td>

      <td data-label="GÃ³i ÄÆ¡n"><strong>${o.package_name || "Locket Gold"}</strong></td>

      <td data-label="UID"><code style="font-size: 0.78rem;">${o.uid || "-"}</code></td>

      <td data-label="Sá»‘ Zalo"><code>${o.zalo || "N/A"}</code></td>

      <td data-label="Sá»‘ Tiá»n"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "Ä‘")}</strong></td>

      <td data-label="Tráº¡ng ThÃ¡i"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thá»i Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="Thao TÃ¡c">

        <div class="action-buttons-cell">

          ${user ? `<button class="btn-sm btn-reup-gold" onclick="reupGoldCustomer('${user}', '${o.order_id}')" title="LÃªn láº¡i Gold cho khÃ¡ch cÅ©"><i class="fa-solid fa-rotate-right"></i> LÃªn Láº¡i Gold</button>` : ""}

          ${user ? `<button class="btn-sm btn-accept" onclick="quickGrantGold('${user}', '${o.order_id}')" title="KÃ­ch hoáº¡t Gold VIP"><i class="fa-solid fa-crown"></i> KÃ­ch Hoáº¡t</button>` : ""}

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="HoÃ n thÃ nh"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="XÃ³a Ä‘Æ¡n"><i class="fa-solid fa-trash"></i> XÃ³a</button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



async function reupGoldCustomer(username, oid) {

  if (!confirm(`XÃ¡c nháº­n LÃŠN Láº I GOLD VIP cho khÃ¡ch cÅ© @${username} (MÃ£ Ä‘Æ¡n #${oid})?`)) return;

  showToast(`Äang lÃªn láº¡i Gold cho @${username}...`, "info");

  try {

    const res = await fetch("/api/admin/locket/reup-gold", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ username: username, order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || `ÄÃ£ lÃªn láº¡i Gold thÃ nh cÃ´ng cho @${username}!`, "success");

      loadAdminOrders("locket");

    } else {

      showToast(data.msg || "Lá»—i khi lÃªn láº¡i Gold.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



async function quickGrantGold(username, oid) {

  if (!confirm(`XÃ¡c nháº­n kÃ­ch hoáº¡t Gold ngay cho tÃ i khoáº£n @${username}?`)) return;

  try {

    const res = await fetch("/api/admin/locket/manual-grant", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ username, order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || `ÄÃ£ gá»­i lá»‡nh kÃ­ch hoáº¡t Gold cho @${username}!`, "success");

      loadOrders();

    } else {

      showToast(data.msg || "KÃ­ch hoáº¡t tháº¥t báº¡i", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



// Báº£ng 3: Máº¡ng XÃ£ Há»™i

function renderMxhOrdersTable(orders) {

  const tbody = document.getElementById("mxhOrdersTableBody");

  if (!tbody) return;

  tbody.innerHTML = "";



  if (orders.length === 0) {

    tbody.innerHTML = `<tr><td colspan="9" class="text-center">Không có đơn hàng nào</td></tr>`;

    return;

  }



  orders.forEach(o => {

    const tr = document.createElement("tr");

    const st = (o.status || "PENDING").toUpperCase();

    let statusClass = "status-pending";

    if (st === "COMPLETED") statusClass = "status-completed";

    if (st === "PROCESSING" || st === "PAID") statusClass = "status-processing";

    if (st === "FAILED") statusClass = "status-failed";



    // Detect Platform

    const link = o.link || "";

    let platIcon = '<i class="fa-solid fa-share-nodes text-cyan"></i>';

    let platName = "MXH";

    const pLow = (o.platform || link).toLowerCase();

    if (pLow.includes("tiktok")) { platIcon = '<i class="fa-brands fa-tiktok text-white"></i>'; platName = "TikTok"; }

    else if (pLow.includes("facebook") || pLow.includes("fb.")) { platIcon = '<i class="fa-brands fa-facebook text-blue"></i>'; platName = "Facebook"; }

    else if (pLow.includes("instagram")) { platIcon = '<i class="fa-brands fa-instagram text-pink"></i>'; platName = "Instagram"; }

    else if (pLow.includes("youtube") || pLow.includes("youtu.be")) { platIcon = '<i class="fa-brands fa-youtube text-danger"></i>'; platName = "YouTube"; }



    const linkEl = link

      ? `<a href="${link}" target="_blank" class="admin-link-truncate" title="${link}"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${link}</a>`

      : '<span class="text-dim">KhÃ´ng cÃ³ link</span>';



    const qty = o.quantity ? Number(o.quantity).toLocaleString() : (o.count || "-");



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="MÃ£ ÄÆ¡n"><strong>#${o.order_id}</strong></td>

      <td data-label="Dá»‹ch Vá»¥">

        <span class="admin-badge badge-blue" style="margin-bottom: 4px; display: inline-flex; align-items: center; gap: 4px;">${platIcon} ${platName}</span><br>

        <strong>${o.package_name || o.service_name || "Dá»‹ch vá»¥ MXH"}</strong>

      </td>

      <td data-label="Link / Zalo">${linkEl}<br><small class="text-dim">Zalo: ${o.zalo || "N/A"}</small></td>

      <td data-label="Sá»‘ LÆ°á»£ng"><strong class="text-cyan">${qty}</strong></td>

      <td data-label="Sá»‘ Tiá»n"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "Ä‘")}</strong></td>

      <td data-label="Tráº¡ng ThÃ¡i"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thá»i Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="MÃ£ MÃ¡y Chá»§"><small>${o.tangtim_order_id ? `<span class="text-cyan">ID #${o.tangtim_order_id}</span>` : "-"}</small></td>

      <td data-label="Thao TÃ¡c">

        <div class="action-buttons-cell">

          ${st === "PENDING" ? `<button class="btn-sm btn-accept" onclick="acceptOrder('${o.order_id}')" title="Duyá»‡t & Äáº©y"><i class="fa-solid fa-check"></i> Duyá»‡t</button>` : ""}

          <button class="btn-sm btn-edit" onclick="adminEditTarget('${o.order_id}', '${link}', 'link')" title="Sá»­a link MXH"><i class="fa-solid fa-pen"></i> Sá»­a</button>

          <button class="btn-sm btn-push" onclick="pushOrder('${o.order_id}')" title="Äáº©y láº¡i"><i class="fa-solid fa-paper-plane"></i> Äáº©y</button>

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="HoÃ n thÃ nh"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="XÃ³a Ä‘Æ¡n"><i class="fa-solid fa-trash"></i> XÃ³a</button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



async function acceptOrder(oid) {

  if (!confirm(`XÃ¡c nháº­n DUYá»†T Ä‘Æ¡n hÃ ng ${oid} vÃ  tá»± Ä‘á»™ng Ä‘áº©y qua Ä‘á»‘i tÃ¡c xá»­ lÃ½?`)) return;

  try {

    const res = await fetch("/api/admin/order/accept", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg, "success");

      loadOrders();

      loadStats();

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ duyá»‡t Ä‘Æ¡n.", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function pushOrder(oid) {

  try {

    const res = await fetch("/api/admin/order/push", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(`ÄÃ£ Ä‘áº©y Ä‘Æ¡n ${oid} thÃ nh cÃ´ng!`, "success");

      loadOrders();

    } else {

      showToast(data.msg || JSON.stringify(data.result), "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function markComplete(oid) {

  try {

    const res = await fetch("/api/admin/order/update-status", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ order_id: oid, status: "COMPLETED" })

    });

    const data = await res.json();

    if (data.success) {

      showToast(`ÄÃ£ Ä‘Ã¡nh dáº¥u hoÃ n thÃ nh Ä‘Æ¡n ${oid}`, "success");

      loadOrders();

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function deleteOrder(oid) {

  if (!confirm(`Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n XÃ“A VÄ¨NH VIá»„N Ä‘Æ¡n hÃ ng #${oid}?\nÄÆ¡n nÃ y sáº½ bá»‹ xÃ³a khá»i toÃ n bá»™ há»‡ thá»‘ng vÃ  KHÃ”NG BAO GIá»œ há»“i láº¡i khi táº£i láº¡i trang.`)) return;

  try {

    addAdminDeletedOrder(oid);

    const uOid = String(oid).toUpperCase();

    const rowEl = document.querySelector(`[data-order-id="${oid}"]`) || document.querySelector(`[data-order-id="${uOid}"]`);

    if (rowEl) rowEl.remove();



    gOrdersList = (gOrdersList || []).filter(o => String(o.order_id || "").toUpperCase() !== uOid);

    loadOrders();

    loadStats();



    const res = await fetch("/api/admin/order/delete", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(`ÄÃ£ xÃ³a vÄ©nh viá»…n Ä‘Æ¡n #${oid}!`, "success");

    } else {

      showToast("Lá»—i xÃ³a: " + (data.msg || "KhÃ´ng thá»ƒ xÃ³a Ä‘Æ¡n"), "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



async function adminEditTarget(oid, currentVal, type) {

  const isCode = type === "code";

  const label = isCode ? "mÃ£ má»i LiÃªn QuÃ¢n" : "link bÃ i viáº¿t MXH";

  const newVal = prompt(`Sá»­a ${label} cho Ä‘Æ¡n #${oid}:`, currentVal || "");

  if (newVal === null) return;

  const trimmed = newVal.trim();

  if (!trimmed) {

    showToast(`Vui lÃ²ng nháº­p ${label} má»›i!`, "warning");

    return;

  }

  showToast("Äang cáº­p nháº­t vÃ  kÃ­ch hoáº¡t láº¡i...", "info");

  try {

    const res = await fetch("/api/order/update-target", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ order_id: oid, new_target: trimmed })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || "Cáº­p nháº­t thÃ nh cÃ´ng!", "success");

      loadOrders();

    } else {

      showToast(data.msg || "Cáº­p nháº­t tháº¥t báº¡i!", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



// ==========================================

// 3. CHUNG Sá»¨C CONFIG

// ==========================================

function initChungSucAdmin() {

  document.getElementById("btnSaveCsConfig").addEventListener("click", saveChungSucConfig);

  document.getElementById("btnTestAutoNhanh").addEventListener("click", testAutoNhanh);



  // Quick % adjustment buttons for Chung Suc packages

  document.querySelectorAll(".btn-cs-adjust").forEach(btn => {

    btn.addEventListener("click", async () => {

      const pct = parseFloat(btn.dataset.pct);

      const actionText = pct > 0 ? `tÄƒng +${pct}%` : `giáº£m ${pct}%`;

      if (!confirm(`Báº¡n cÃ³ cháº¯c muá»‘n ${actionText} giÃ¡ cá»§a táº¥t cáº£ gÃ³i Chung Sá»©c?`)) return;

      try {

        const res = await fetch("/api/admin/chungsuc/adjust-percent", {

          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ percent: pct })

        });

        const data = await res.json();

        if (data.success) {

          showToast(data.msg, "success");

          if (data.packages) renderCsPackagesEditor(data.packages);

        } else {

          showToast(data.msg || "Lá»—i cáº­p nháº­t giÃ¡!", "error");

        }

      } catch (e) {

        showToast("Lá»—i máº¡ng: " + e.message, "error");

      }

    });

  });

}



function renderCsPackagesEditor(pkgs) {

  const container = document.getElementById("csPackagesEditor");

  container.innerHTML = "";



  Object.keys(pkgs).forEach(key => {

    const pkg = pkgs[key];

    const row = document.createElement("div");

    row.className = "pkg-edit-row";

    row.innerHTML = `

      <div class="pkg-edit-info">

        <strong>${pkg.name}</strong> <code>(${key})</code>

      </div>

      <div class="pkg-edit-inputs">

        <label>GiÃ¡ (VNÄ):</label>

        <input type="number" class="admin-input cs-price-input" data-id="${key}" value="${pkg.price || 0}">

        <label>LÆ°á»£t buff:</label>

        <input type="number" class="admin-input cs-turns-input" data-id="${key}" value="${pkg.turns || 0}">

      </div>

    `;

    container.appendChild(row);

  });

}



async function testAutoNhanh() {

  const btn = document.getElementById("btnTestAutoNhanh");

  btn.disabled = true;

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang káº¿t ná»‘i...`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);



  try {

    const res = await fetch("/api/admin/autonhanh/balance", { signal: controller.signal });

    const data = await res.json();

    const bal = data.success ? data.balance : null;

    if (bal !== null && bal !== undefined) {

      showToast(`Káº¿t ná»‘i AutoNhanh thÃ nh cÃ´ng! Sá»‘ dÆ° hiá»‡n táº¡i: ${bal.toLocaleString("vi-VN")} Xu`, "success");

    } else {

      showToast("KhÃ´ng thá»ƒ Ä‘Äƒng nháº­p AutoNhanh. Vui lÃ²ng kiá»ƒm tra láº¡i tÃ i khoáº£n vÃ  máº­t kháº©u.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  } finally {

    clearTimeout(timeoutId);
    btn.disabled = false;

    btn.innerHTML = `<i class="fa-solid fa-key"></i> ÄÄƒng Nháº­p & Kiá»ƒm Tra Sá»‘ DÆ° Xu`;

  }

}



async function saveChungSucConfig() {

  const user = document.getElementById("anUsername").value.trim();

  const pwd = document.getElementById("anPassword").value.trim();

  const priceXu = parseInt(document.getElementById("anPriceXu").value) || 760;



  const pkgs = gAdminConfig.chungsuc_packages || {};

  document.querySelectorAll(".cs-price-input").forEach(inp => {

    const id = inp.dataset.id;

    if (pkgs[id]) {

      pkgs[id].price = parseInt(inp.value) || 0;

      pkgs[id].price_formatted = pkgs[id].price.toLocaleString("vi-VN") + "Ä‘";

    }

  });

  document.querySelectorAll(".cs-turns-input").forEach(inp => {

    const id = inp.dataset.id;

    if (pkgs[id]) pkgs[id].turns = parseInt(inp.value) || 0;

  });



  const payload = {

    packages: pkgs,

    autonhanh: {

      username: user,

      password: pwd,

      price_per_pack_xu: priceXu

    }

  };



  try {

    const res = await fetch("/api/admin/chungsuc/config", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(payload)

    });

    const data = await res.json();

    if (data.success) {

      showToast("LÆ°u cáº¥u hÃ¬nh Chung Sá»©c thÃ nh cÃ´ng!", "success");

    } else {

      showToast(data.msg || "Lá»—i lÆ°u cáº¥u hÃ¬nh", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



// ==========================================

// 4. LOCKET GOLD CONFIG

// ==========================================

function initLocketAdmin() {

  document.getElementById("btnManualGrantGold").addEventListener("click", handleManualGrantGold);

  document.getElementById("btnAddTokenSetModalBtn").addEventListener("click", () => {

    openAddTokenModal();

  });

  document.getElementById("btnSaveNewToken").addEventListener("click", handleAddToken);

  document.getElementById("btnSaveLocketAdvanced").addEventListener("click", handleSaveAdvancedLocket);



  // Locket Login Handler

  const btnLocketLogin = document.getElementById("btn_locket_login");

  if (btnLocketLogin) {

    btnLocketLogin.addEventListener("click", handleLocketLogin);

  }



  // Locket Raw Catcher Handler

  const btnImportLocketRaw = document.getElementById("btnImportLocketRaw");

  if (btnImportLocketRaw) {

    btnImportLocketRaw.addEventListener("click", handleImportLocketRaw);

  }



  // Save Locket prices

  const btnSaveLkPrice = document.getElementById("btnSaveLocketPrices");

  if (btnSaveLkPrice) {

    btnSaveLkPrice.addEventListener("click", async () => {

      const pNo = parseInt(document.getElementById("locketPriceNoDns").value) || 10000;

      const pWith = parseInt(document.getElementById("locketPriceWithDns").value) || 30000;

      btnSaveLkPrice.disabled = true;

      btnSaveLkPrice.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang lÆ°u...';

      try {

        await fetch("/api/admin/price", {

          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ package_id: "no_dns", price: pNo })

        });

        const res2 = await fetch("/api/admin/price", {

          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ package_id: "with_dns", price: pWith })

        });

        const data2 = await res2.json();

        showToast(data2.msg || "ÄÃ£ lÆ°u báº£ng giÃ¡ Locket Gold thÃ nh cÃ´ng!", "success");

      } catch (e) {

        showToast("Lá»—i khi lÆ°u giÃ¡ Locket: " + e.message, "error");

      } finally {

        btnSaveLkPrice.disabled = false;

        btnSaveLkPrice.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> LÆ°u Báº£ng GiÃ¡ Locket Gold';

      }

    });

  }



  // Smart Auto-Parse Raw Token listener

  const rawInput = document.getElementById("smartRawInput");

  if (rawInput) {

    rawInput.addEventListener("input", () => {

      autoParseSmartRawToken(rawInput.value);

    });

  }



  // Paste from clipboard button

  const pasteBtn = document.getElementById("btnPasteRawToken");

  if (pasteBtn) {

    pasteBtn.addEventListener("click", async () => {

      try {

        const text = await navigator.clipboard.readText();

        if (text && rawInput) {

          rawInput.value = text;

          autoParseSmartRawToken(text);

          showToast("ÄÃ£ dÃ¡n vÃ  tá»± Ä‘á»™ng bÃ³c tÃ¡ch token!", "success");

        }

      } catch (e) {

        if (rawInput) rawInput.focus();

      }

    });

  }

}



function autoParseSmartRawToken(raw) {

  if (!raw || !raw.trim()) return;

  const text = raw.trim();



  let fetchToken = "";

  let appTrans = "";

  let transId = "";

  let prodId = "";

  let rcBearer = "";



  // 1. Multi-line regex extractors with whitespace & newline stripping

  // Fetch Token: require quotes around "fetch_token" to match JSON field, allowing multi-line string

  const mFt = text.match(/["']fetch_token["']\s*[:=]\s*["']([A-Za-z0-9_\-\.\r\n\s]+)["']/i);

  if (mFt) {

    fetchToken = mFt[1].replace(/[\s\r\n]+/g, "");

  }



  // App Transaction: require quotes around "app_transaction" to prevent matching "x-post-params-hash" in HTTP headers

  const mAt = text.match(/["']app_transaction["']\s*[:=]\s*["']([A-Za-z0-9_\-\.\r\n\s]+)["']/i);

  if (mAt) {

    appTrans = mAt[1].replace(/[\s\r\n]+/g, "");

  }



  // Transaction ID

  const mTi = text.match(/["']?transaction_id["']?\s*[:=]\s*["']?([0-9]+)["']?/i);

  if (mTi) transId = mTi[1];



  // Product ID

  const mPi = text.match(/["']?product_id["']?\s*[:=]\s*["']([A-Za-z0-9_\-\.]+)["']/i);

  if (mPi) prodId = mPi[1];



  // RevenueCat Bearer token in headers

  const mBearer = text.match(/[Aa]uthorization:\s*(Bearer\s+appl_[A-Za-z0-9_]+)/i);

  if (mBearer) {

    rcBearer = mBearer[1].trim();

  }



  // 2. Fallback: Parse JSON after cleaning unescaped control characters inside string literals

  if (!fetchToken || !appTrans) {

    try {

      const jsonMatch = text.match(/(\{[\s\S]*\})/);

      if (jsonMatch) {

        const sanitizedJson = jsonMatch[1].replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m, str) => {

          return '"' + str.replace(/[\r\n\t]+/g, '') + '"';

        });

        const jsonObj = JSON.parse(sanitizedJson);

        if (jsonObj && typeof jsonObj === "object") {

          if (!fetchToken && jsonObj.fetch_token) fetchToken = String(jsonObj.fetch_token).replace(/[\s\r\n]+/g, "");

          if (!appTrans && jsonObj.app_transaction) appTrans = String(jsonObj.app_transaction).replace(/[\s\r\n]+/g, "");

          if (!transId && jsonObj.transaction_id) transId = String(jsonObj.transaction_id);

          if (!prodId && jsonObj.product_id) prodId = String(jsonObj.product_id);

        }

      }

    } catch (e) {}

  }



  // 3. Fallback: Search all eyJ JWS tokens after stripping all whitespace from text

  if (!fetchToken || !appTrans) {

    const cleanOneLine = text.replace(/[\s\r\n]+/g, "");

    const jwts = cleanOneLine.match(/eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g) || [];

    if (jwts.length >= 2) {

      if (!fetchToken) fetchToken = jwts[0];

      if (!appTrans) appTrans = jwts[1];

    } else if (jwts.length === 1 && !fetchToken) {

      fetchToken = jwts[0];

    }

  }



  // Populate form fields

  if (fetchToken) {

    document.getElementById("newTokenFetch").value = fetchToken;

    const b = document.getElementById("badgeFetchStatus");

    if (b) b.innerHTML = `<span style="color:#34d399; font-weight:700;"><i class="fa-solid fa-check"></i> ÄÃ£ bÃ³c tÃ¡ch (${fetchToken.length} kÃ½ tá»±)</span>`;

  }

  if (appTrans) {

    document.getElementById("newTokenAppTrans").value = appTrans;

    const b = document.getElementById("badgeAppTransStatus");

    if (b) b.innerHTML = `<span style="color:#34d399; font-weight:700;"><i class="fa-solid fa-check"></i> ÄÃ£ bÃ³c tÃ¡ch (${appTrans.length} kÃ½ tá»±)</span>`;

  }

  if (transId) {

    const el = document.getElementById("newTokenTransId");

    if (el) el.value = transId;

  }

  if (prodId) {

    const el = document.getElementById("newTokenProductId");

    if (el) el.value = prodId;

  }

  if (rcBearer) {

    const el = document.getElementById("locketRevenueCatBearer");

    if (el) el.value = rcBearer;

  }



  // Auto-generate name if empty

  const nameInput = document.getElementById("newTokenName");

  if (nameInput && (!nameInput.value || nameInput.value.startsWith("Token StoreKit"))) {

    nameInput.value = `Token StoreKit 2 (${prodId || "1 ThÃ¡ng"} - #${transId || "VIP"})`;

  }



  const statusBox = document.getElementById("smartParseStatus");

  if (statusBox) {

    if (fetchToken && appTrans) {

      statusBox.style.display = "block";

      statusBox.style.background = "rgba(16, 185, 129, 0.15)";

      statusBox.style.color = "#34d399";

      statusBox.style.border = "1px solid rgba(16, 185, 129, 0.35)";

      statusBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>ÄÃ£ tá»± Ä‘á»™ng bÃ³c tÃ¡ch thÃ nh cÃ´ng 100%!</strong> ÄÃ£ nháº­n diá»‡n Ä‘áº§y Ä‘á»§ Fetch Token (${fetchToken.length} kÃ½ tá»±) & App Transaction (${appTrans.length} kÃ½ tá»±).`;

    } else if (fetchToken || appTrans) {

      statusBox.style.display = "block";

      statusBox.style.background = "rgba(234, 179, 8, 0.15)";

      statusBox.style.color = "#fde047";

      statusBox.style.border = "1px solid rgba(234, 179, 8, 0.35)";

      statusBox.innerHTML = `<i class="fa-solid fa-circle-info"></i> ÄÃ£ nháº­n diá»‡n Ä‘Æ°á»£c 1 Token. Vui lÃ²ng kiá»ƒm tra trÆ°á»ng cÃ²n láº¡i bÃªn dÆ°á»›i.`;

    } else {

      statusBox.style.display = "block";

      statusBox.style.background = "rgba(239, 68, 68, 0.15)";

      statusBox.style.color = "#f87171";

      statusBox.style.border = "1px solid rgba(239, 68, 68, 0.35)";

      statusBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> KhÃ´ng thá»ƒ nháº­n diá»‡n Token. HÃ£y cháº¯c cháº¯n báº¡n Ä‘Ã£ dÃ¡n Ä‘áº§y Ä‘á»§ Request cÃ³ chá»©a fetch_token vÃ  app_transaction.`;

    }

  }

}



async function loadLocketTokens() {

  const tbody = document.getElementById("locketTokensTableBody");

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Äang táº£i danh sÃ¡ch token...</td></tr>`;



  try {

    const res = await fetch("/api/admin/locket/tokens");

    const data = await res.json();

    if (data.success && data.tokens) {

      renderLocketTokensTable(data.tokens);

    }

  } catch (e) {

    tbody.innerHTML = `<tr><td colspan="5" style="color: red;">Lá»—i táº£i token: ${e.message}</td></tr>`;

  }

}



function renderLocketTokensTable(tokens) {

  const tbody = document.getElementById("locketTokensTableBody");

  tbody.innerHTML = "";



  if (tokens.length === 0) {

    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--admin-muted);">ChÆ°a cÃ³ bá»™ token StoreKit 2 nÃ o trong há»‡ thá»‘ng.</td></tr>`;

    return;

  }



  tokens.forEach(t => {

    const tr = document.createElement("tr");

    tr.innerHTML = `

      <td><strong>${t.name}</strong><br><small class="text-dim">ID: ${t.id}</small></td>

      <td><code>${t.product_id}</code></td>

      <td>${t.days_text || t.status_text}</td>

      <td>${t.active ? `<span class="admin-badge badge-green">Hoáº¡t Äá»™ng</span>` : `<span class="admin-badge badge-red">Táº¯t</span>`}</td>

      <td>

        <div class="action-buttons-cell">

          <button class="btn-sm btn-push" onclick="testLocketToken('${t.id}')" title="Test Token"><i class="fa-solid fa-vial"></i> Test</button>

          <button class="btn-sm btn-accept" onclick="toggleLocketToken('${t.id}')" title="Báº­t/Táº¯t"><i class="fa-solid fa-power-off"></i></button>

          <button class="btn-sm btn-delete" onclick="deleteLocketToken('${t.id}')" title="XÃ³a"><i class="fa-solid fa-trash"></i></button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



async function testLocketToken(tid) {

  try {

    const res = await fetch("/api/admin/locket/tokens/test", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ id: tid })

    });

    const data = await res.json();

    if (data.success) {

      showToast("Token há»£p lá»‡ vÃ  hoáº¡t Ä‘á»™ng tá»‘t!", "success");

    } else {

      showToast("Token lá»—i: " + (data.msg || JSON.stringify(data.result)), "error");

    }

  } catch (e) {

    showToast("Lá»—i test token: " + e.message, "error");

  }

}



async function toggleLocketToken(tid) {

  try {

    const res = await fetch("/api/admin/locket/tokens/toggle", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ id: tid })

    });

    const data = await res.json();

    if (data.success) {

      showToast("ÄÃ£ thay Ä‘á»•i tráº¡ng thÃ¡i token!", "success");

      loadLocketTokens();

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function deleteLocketToken(tid) {

  if (!confirm("Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n XÃ“A bá»™ token nÃ y?")) return;

  try {

    const res = await fetch("/api/admin/locket/tokens/delete", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ id: tid })

    });

    const data = await res.json();

    if (data.success) {

      showToast("ÄÃ£ xÃ³a token!", "success");

      loadLocketTokens();

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function handleAddToken() {

  const rawInput = document.getElementById("smartRawInput");

  if (rawInput && rawInput.value.trim()) {

    autoParseSmartRawToken(rawInput.value);

  }



  const name = document.getElementById("newTokenName").value.trim();

  const fetchToken = document.getElementById("newTokenFetch").value.trim();

  const appTrans = document.getElementById("newTokenAppTrans").value.trim();

  const transId = document.getElementById("newTokenTransId") ? document.getElementById("newTokenTransId").value.trim() : "570002518164026";

  const prodId = document.getElementById("newTokenProductId") ? document.getElementById("newTokenProductId").value.trim() : "locket_199_1m";

  const rawText = rawInput ? rawInput.value.trim() : "";



  if (!fetchToken && !rawText) {

    showToast("Vui lÃ²ng dÃ¡n ná»™i dung Token hoáº·c Request vÃ o Ã´ bÃ³c tÃ¡ch!", "error");

    return;

  }



  try {

    const res = await fetch("/api/admin/locket/tokens/add", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        name: name || "Token má»›i (StoreKit 2)",

        fetch_token: fetchToken,

        app_transaction: appTrans,

        transaction_id: transId,

        product_id: prodId,

        raw: rawText

      })

    });

    const data = await res.json();

    if (data.success) {

      showToast("ThÃªm vÃ  kÃ­ch hoáº¡t token thÃ nh cÃ´ng!", "success");

      closeAddTokenModal();

      loadLocketTokens();

      // Clear inputs

      if (rawInput) rawInput.value = "";

      document.getElementById("newTokenName").value = "";

      document.getElementById("newTokenFetch").value = "";

      document.getElementById("newTokenAppTrans").value = "";

      const statusBox = document.getElementById("smartParseStatus");

      if (statusBox) statusBox.style.display = "none";

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ thÃªm token", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



function openAddTokenModal() {

  const modal = document.getElementById("addTokenModal");

  if (modal) {

    modal.style.setProperty("display", "flex", "important");

    modal.classList.add("active", "show");

  }

}



function closeAddTokenModal() {

  const modal = document.getElementById("addTokenModal");

  if (modal) {

    modal.style.setProperty("display", "none", "important");

    modal.classList.remove("active", "show");

  }

}



window.openAddTokenModal = openAddTokenModal;

window.closeAddTokenModal = closeAddTokenModal;



// Close modal on backdrop click or ESC key

document.addEventListener("DOMContentLoaded", () => {

  const modal = document.getElementById("addTokenModal");

  if (modal) {

    modal.addEventListener("click", (e) => {

      if (e.target === modal) closeAddTokenModal();

    });

  }

  document.addEventListener("keydown", (e) => {

    if (e.key === "Escape") closeAddTokenModal();

  });

});



async function handleManualGrantGold() {

  const inp = document.getElementById("manualLocketUser");

  const val = inp.value.trim();

  if (!val) {

    showToast("Vui lÃ²ng nháº­p Username Locket!", "error");

    inp.focus();

    return;

  }



  try {

    const res = await fetch("/api/admin/locket/manual-grant", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ username: val })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg, "success");

      inp.value = "";

    } else {

      showToast(data.msg || "Lá»—i kÃ­ch hoáº¡t Gold", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function handleSaveAdvancedLocket() {

  const rc = document.getElementById("locketRevenueCatBearer").value.trim();

  const fb = document.getElementById("locketFirebaseAppCheck").value.trim();

  const lb = document.getElementById("adv_locket_bearer") ? document.getElementById("adv_locket_bearer").value.trim() : "";



  try {

    const res = await fetch("/api/admin/locket/tokens/advanced", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        revenuecat_bearer: rc,

        firebase_appcheck: fb,

        locket_bearer: lb

      })

    });

    const data = await res.json();

    if (data.success) {

      showToast("LÆ°u Advanced Tokens thÃ nh cÃ´ng!", "success");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



// ==========================================

// 5. MXH CONFIG

// ==========================================

function initMxhAdmin() {

  document.getElementById("btnSaveMxhConfig").addEventListener("click", saveMxhConfig);

  document.getElementById("btnSyncMxhServices").addEventListener("click", syncMxhServices);



  // Check TangTim balance button

  const btnCheckBal = document.getElementById("btnCheckTangTimBal");

  if (btnCheckBal) {

    btnCheckBal.addEventListener("click", async () => {

      btnCheckBal.disabled = true;

      btnCheckBal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang kiá»ƒm tra...';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {

        const res = await fetch("/api/admin/tangtim/balance", { signal: controller.signal });

        const data = await res.json();

        if (data.success) {

          showToast(`Sá»‘ dÆ° TangTim: ${data.balance_usd}$ (~${data.balance_formatted})`, "success");

          const el = document.getElementById("balTangTim");

          if (el) el.textContent = data.balance_formatted;

        } else {

          showToast(data.msg || "KhÃ´ng thá»ƒ láº¥y sá»‘ dÆ° TangTim", "error");

        }

      } catch (e) {

        showToast("Lá»—i máº¡ng: " + e.message, "error");

      } finally {

        clearTimeout(timeoutId);
        btnCheckBal.disabled = false;

        btnCheckBal.innerHTML = '<i class="fa-solid fa-wallet text-gold"></i> Kiá»ƒm Tra Sá»‘ DÆ° TangTim';

      }

    });

  }



  // Sync maintenance status button

  const btnSyncMaint = document.getElementById("btnSyncMaintenance");

  if (btnSyncMaint) {

    btnSyncMaint.addEventListener("click", async () => {

      btnSyncMaint.disabled = true;

      btnSyncMaint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang quÃ©t...';

      try {

        const res = await fetch("/api/admin/tangtim/sync-maintenance", { method: "POST" });

        const data = await res.json();

        showToast(data.msg || "ÄÃ£ quÃ©t tráº¡ng thÃ¡i báº£o trÃ¬!", data.success ? "success" : "error");

      } catch (e) {

        showToast("Lá»—i máº¡ng: " + e.message, "error");

      } finally {

        btnSyncMaint.disabled = false;

        btnSyncMaint.innerHTML = '<i class="fa-solid fa-shield-halved text-cyan"></i> QuÃ©t Báº£o TrÃ¬ MÃ¡y Chá»§';

      }

    });

  }



  // Topbar quick jump to margin input

  const btnTopMargin = document.getElementById("btnTopMargin");

  if (btnTopMargin) {

    btnTopMargin.addEventListener("click", () => {

      const mxhTabBtn = document.querySelector('.sidebar-tab[data-tab="mxh"]');

      if (mxhTabBtn) mxhTabBtn.click();

      const inp = document.getElementById("setTtMargin");

      if (inp) {

        inp.scrollIntoView({ behavior: "smooth", block: "center" });

        inp.focus();

        inp.select();

      }

    });

  }



  // Quick margin preset buttons

  document.querySelectorAll(".btn-quick-margin").forEach(btn => {

    btn.addEventListener("click", () => {

      const m = btn.dataset.margin;

      const inp = document.getElementById("setTtMargin");

      if (inp) {

        inp.value = m;

        inp.focus();

      }

    });

  });



  // Save Margin Percent

  const btnSaveMargin = document.getElementById("btnSaveMarginPercent");

  if (btnSaveMargin) {

    btnSaveMargin.addEventListener("click", async () => {

      const inp = document.getElementById("setTtMargin");

      const marginVal = parseFloat(inp ? inp.value : 50);

      if (isNaN(marginVal) || marginVal < 0) {

        showToast("Vui lÃ²ng nháº­p tá»· lá»‡ % há»£p lá»‡ (>= 0)!", "error");

        return;

      }

      btnSaveMargin.disabled = true;

      btnSaveMargin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang tÃ­nh láº¡i giÃ¡ toÃ n bá»™ dá»‹ch vá»¥...`;

      try {

        const res = await fetch("/api/admin/margin", {

          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ margin_percent: marginVal })

        });

        const data = await res.json();

        if (data.success) {

          showToast(data.msg || `ÄÃ£ cáº­p nháº­t tá»· lá»‡ chÃªnh lá»‡ch giÃ¡ thÃ nh +${marginVal}%!`, "success");

          const badgeMargin = document.getElementById("badgeCurrentMargin");

          if (badgeMargin) badgeMargin.textContent = `Hiá»‡n táº¡i: +${marginVal}%`;

          const topMarginBtn = document.getElementById("btnTopMargin");

          if (topMarginBtn) topMarginBtn.innerHTML = `<i class="fa-solid fa-percent"></i> <span>Chá»‰nh % GiÃ¡ (+${marginVal}%)</span>`;

        } else {

          showToast(data.msg || "Lá»—i khi lÆ°u tá»· lá»‡ %!", "error");

        }

      } catch (e) {

        showToast("Lá»—i máº¡ng: " + e.message, "error");

      } finally {

        btnSaveMargin.disabled = false;

        btnSaveMargin.innerHTML = `<i class="fa-solid fa-calculator"></i> Ãp Dá»¥ng & TÃ­nh Láº¡i GiÃ¡ BÃ¡n ToÃ n Bá»™ Dá»‹ch Vá»¥`;

      }

    });

  }

}



async function syncMxhServices() {

  const btn = document.getElementById("btnSyncMxhServices");

  btn.disabled = true;

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang Ä‘á»“ng bá»™...`;



  try {

    const res = await fetch("/api/admin/mxh/sync-services", { method: "POST" });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg, "success");

    } else {

      showToast(data.msg || "Lá»—i Ä‘á»“ng bá»™ dá»‹ch vá»¥.", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Äá»“ng Bá»™ Danh Má»¥c Tá»« TangTim`;

  }

}



async function saveMxhConfig() {

  const key = document.getElementById("ttApiKey").value.trim();

  const url = document.getElementById("ttApiUrl").value.trim();

  const saleEnabled = document.getElementById("saleEnabled").value === "true";

  const salePercent = parseFloat(document.getElementById("salePercent").value) || 25;

  const durationDays = parseInt(document.getElementById("saleDurationDays").value) || 5;



  const now = Date.now() / 1000;

  const saleCampaign = {

    enabled: saleEnabled,

    discount_percent: salePercent,

    duration_days: durationDays,

    start_time: now,

    end_time: now + durationDays * 86400

  };



  const payload = {

    tangtim: {

      api_key: key,

      api_url: url

    },

    sale_campaign: saleCampaign

  };



  try {

    const res = await fetch("/api/admin/mxh/config", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(payload)

    });

    const data = await res.json();

    if (data.success) {

      showToast("LÆ°u cáº¥u hÃ¬nh MXH & Flash Sale thÃ nh cÃ´ng!", "success");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



// ==========================================

// 6. PAYMENT CONFIG

// ==========================================

function initPaymentAdmin() {

  document.getElementById("btnSavePaymentConfig").addEventListener("click", savePaymentConfig);

  loadUnmatchedTransactions();

}



async function loadUnmatchedTransactions() {

  const tbody = document.getElementById("unmatchedTransBody");

  if (!tbody) return;



  try {

    const res = await fetch("/api/admin/unmatched-transactions");

    const data = await res.json();

    if (!data.success || !data.transactions || data.transactions.length === 0) {

      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--admin-muted); padding: 20px;">

        <i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Tuyá»‡t vá»i! Hiá»‡n khÃ´ng cÃ³ dÃ²ng tiá»n nÃ o bá»‹ sai cÃº phÃ¡p hoáº·c chÆ°a khá»›p lá»‡nh.

      </td></tr>`;

      return;

    }



    tbody.innerHTML = data.transactions.map(item => {

      const isMatched = item.status === "MATCHED";

      return `

        <tr>

          <td><code class="font-mono" style="color: #60a5fa; font-weight: 700;">${item.trans_id}</code></td>

          <td><strong style="color: #34d399;">${item.amount_formatted || item.amount.toLocaleString('vi-VN') + 'Ä‘'}</strong></td>

          <td style="max-width: 260px; font-size: 0.8rem; word-break: break-all;">${item.description || 'N/A'}</td>

          <td style="font-size: 0.8rem; color: var(--admin-muted);">${item.trans_time || ''}</td>

          <td>

            ${isMatched ? `<span class="badge badge-success" style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 4px 8px; border-radius: 4px;">ÄÃ£ gÃ¡n #${item.matched_order_id}</span>` : `

              <input type="text" id="assign_order_${item.trans_id}" placeholder="#CS... hoáº·c #LK..." class="admin-input" style="padding: 6px 10px; font-size: 0.82rem; width: 100%;">

            `}

          </td>

          <td style="text-align: center;">

            ${isMatched ? `<i class="fa-solid fa-check text-green" style="color: #10b981;"></i>` : `

              <button type="button" class="btn-admin-primary" onclick="assignUnmatchedTrans('${item.trans_id}')" style="padding: 6px 12px; font-size: 0.8rem; white-space: nowrap;">

                <i class="fa-solid fa-link"></i> GÃ¡n ÄÆ¡n

              </button>

            `}

          </td>

        </tr>

      `;

    }).join("");

  } catch (e) {

    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Lá»—i táº£i dá»¯ liá»‡u: ${e.message}</td></tr>`;

  }

}



async function assignUnmatchedTrans(transId) {

  const input = document.getElementById(`assign_order_${transId}`);

  if (!input) return;

  const orderId = input.value.trim().toUpperCase();

  if (!orderId) {

    showToast("Vui lÃ²ng nháº­p MÃ£ Ä‘Æ¡n hÃ ng cáº§n gÃ¡n (#CS..., #LK..., #TT...)", "error");

    return;

  }



  if (!confirm(`XÃ¡c nháº­n gÃ¡n giao dá»‹ch ${transId} vÃ o Ä‘Æ¡n hÃ ng #${orderId} vÃ  kÃ­ch hoáº¡t tráº£ hÃ ng tá»± Ä‘á»™ng?`)) {

    return;

  }



  try {

    const res = await fetch("/api/admin/match-transaction", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ trans_id: transId, order_id: orderId })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg, "success");

      loadUnmatchedTransactions();

    } else {

      showToast(data.msg || "GÃ¡n Ä‘Æ¡n tháº¥t báº¡i", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



async function savePaymentConfig() {

  const bankId = document.getElementById("bankId").value.trim();

  const bankName = document.getElementById("bankName").value.trim();

  const accNo = document.getElementById("accountNumber").value.trim();

  const accName = document.getElementById("accountName").value.trim();

  const thueToken = document.getElementById("thueapiToken").value.trim();

  const thuePhone = document.getElementById("thueapiPhone").value.trim();



  const payload = {

    bank_id: bankId,

    bank_name: bankName,

    account_number: accNo,

    account_name: accName,

    thueapibank: {

      enabled: true,

      token: thueToken,

      phone: thuePhone

    }

  };



  try {

    const res = await fetch("/api/admin/config/payment", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(payload)

    });

    const data = await res.json();

    if (data.success) {

      showToast("LÆ°u thÃ´ng tin ngÃ¢n hÃ ng thÃ nh cÃ´ng!", "success");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



// ==========================================

// 7. SETTINGS & SYSTEM

// ==========================================

function initSettingsAdmin() {

  document.getElementById("btnSaveTgConfig").addEventListener("click", saveTelegramConfig);

  document.getElementById("btnTestTg").addEventListener("click", testTelegram);

  document.getElementById("btnSaveAdminPassword").addEventListener("click", changeAdminPassword);

  document.getElementById("btnSaveGhConfig").addEventListener("click", saveGithubConfig);



  const btnSaveToggle = document.getElementById("btnSaveServicesToggle");

  if (btnSaveToggle) {

    btnSaveToggle.addEventListener("click", () => saveServicesToggle(false));

  }



  // Tá»± Ä‘á»™ng lÆ°u khi gáº¡t báº¥t ká»³ cÃ´ng táº¯c nÃ o

  ["toggleServiceChungSuc", "toggleServiceLocket", "toggleServiceMxh", "toggleServicePremium"].forEach(id => {

    const el = document.getElementById(id);

    if (el) {

      el.addEventListener("change", () => {

        saveServicesToggle(true);

      });

    }

  });



  loadServicesToggle();

}



async function loadServicesToggle() {

  try {

    const res = await fetch("/api/admin/services-toggle?t=" + Date.now());

    const data = await res.json();

    if (data.success && data.services_enabled) {

      const se = data.services_enabled;

      const cs = document.getElementById("toggleServiceChungSuc");

      const lk = document.getElementById("toggleServiceLocket");

      const mxh = document.getElementById("toggleServiceMxh");

      const pr = document.getElementById("toggleServicePremium");

      if (cs) cs.checked = se.chungsuc !== false;

      if (lk) lk.checked = se.locket !== false;

      if (mxh) mxh.checked = se.mxh !== false;

      if (pr) pr.checked = se.premium !== false;

    }

  } catch (e) {

    console.warn("Could not load services-toggle:", e);

  }

}



async function saveServicesToggle(isInstant = false) {

  const cs = document.getElementById("toggleServiceChungSuc") ? document.getElementById("toggleServiceChungSuc").checked : true;

  const lk = document.getElementById("toggleServiceLocket") ? document.getElementById("toggleServiceLocket").checked : true;

  const mxh = document.getElementById("toggleServiceMxh") ? document.getElementById("toggleServiceMxh").checked : true;

  const pr = document.getElementById("toggleServicePremium") ? document.getElementById("toggleServicePremium").checked : true;

  const btn = document.getElementById("btnSaveServicesToggle");



  if (btn && !isInstant) {

    btn.disabled = true;

    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Äang lÆ°u...`;

  }



  try {

    const payload = { chungsuc: cs, locket: lk, mxh: mxh, premium: pr };

    const res = await fetch("/api/admin/services-toggle", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(payload)

    });

    const data = await res.json();

    if (data.success) {

      showToast("âœ… ÄÃ£ lÆ°u tráº¡ng thÃ¡i hiá»ƒn thá»‹ dá»‹ch vá»¥ thÃ nh cÃ´ng!", "success");

    } else {

      showToast(data.msg || "Lá»—i lÆ°u cáº¥u hÃ¬nh dá»‹ch vá»¥", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  } finally {

    if (btn && !isInstant) {

      btn.disabled = false;

      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> LÆ°u Tráº¡ng ThÃ¡i Dá»‹ch Vá»¥`;

    }

  }

}



async function saveTelegramConfig() {

  const token = document.getElementById("tgBotToken").value.trim();

  const chat = document.getElementById("tgChatId").value.trim();



  try {

    const res = await fetch("/api/admin/config/telegram", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ bot_token: token, chat_id: chat, enabled: true })

    });

    const data = await res.json();

    if (data.success) showToast("LÆ°u Telegram Bot thÃ nh cÃ´ng!", "success");

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function testTelegram() {

  try {

    const res = await fetch("/api/admin/config/telegram/test", { method: "POST" });

    const data = await res.json();

    if (data.success) {

      showToast("ÄÃ£ gá»­i tin nháº¯n test Ä‘áº¿n Telegram!", "success");

    } else {

      showToast(data.msg || "Lá»—i gá»­i test", "error");

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function changeAdminPassword() {

  const pwd = document.getElementById("newAdminPassword").value.trim();

  if (!pwd) {

    showToast("Vui lÃ²ng nháº­p máº­t kháº©u má»›i!", "error");

    return;

  }



  try {

    const res = await fetch("/api/admin/config/password", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ password: pwd })

    });

    const data = await res.json();

    if (data.success) {

      showToast("ÄÃ£ cáº­p nháº­t máº­t kháº©u Admin!", "success");

      document.getElementById("newAdminPassword").value = "";

    }

  } catch (e) {

    showToast("Lá»—i: " + e.message, "error");

  }

}



async function saveGithubConfig() {
  const repoInput = document.getElementById("ghRepo");
  const repo = (repoInput ? repoInput.value.trim() : "") || "cheatdth206/chungsuclienquan";
  const tokenInput = document.getElementById("ghToken");
  const token = tokenInput ? tokenInput.value.trim() : "";
  const btn = document.getElementById("btnSaveGhConfig");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang test & lưu sync...`;
  }

  try {
    const res = await fetch("/api/admin/github-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repo, token: token, branch: "main", sync_enabled: true })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.msg || "Đã lưu và đồng bộ GitHub!", "success");
    } else {
      showToast(data.msg || "Lỗi sync GitHub", "error");
    }
  } catch (e) {
    showToast("Lỗi: " + e.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Lưu & Test Sync GitHub`;
    }
  }
}



// ==========================================

// LOAD FULL CONFIG VALUES INTO FORM FIELDS

// ==========================================

async function loadFullConfig() {

  try {

    const res = await fetch("/api/admin/config");

    const data = await res.json();

    if (!data.success || !data.config) return;



    gAdminConfig = data.config;

    const cfg = data.config;



    // Chung Sá»©c

    const an = cfg.autonhanh || {};

    document.getElementById("anUsername").value = an.username || "";

    document.getElementById("anPassword").value = an.password || "";

    document.getElementById("anPriceXu").value = an.price_per_pack_xu || 760;

    renderCsPackagesEditor(cfg.chungsuc_packages || {});



    // Locket

    const apiTokens = cfg.api_tokens || {};

    document.getElementById("locketRevenueCatBearer").value = apiTokens.revenuecat_bearer || "";

    document.getElementById("locketFirebaseAppCheck").value = apiTokens.firebase_appcheck || "";

    if (document.getElementById("adv_locket_bearer")) {

      document.getElementById("adv_locket_bearer").value = apiTokens.locket_bearer || "";

    }



    // MXH

    const tt = cfg.tangtim || {};

    document.getElementById("ttApiKey").value = tt.api_key || "";

    document.getElementById("ttApiUrl").value = tt.api_url || "https://tangtim.vn/api/v2";



    const margin = tt.margin_percent !== undefined ? tt.margin_percent : 50;

    const marginInp = document.getElementById("setTtMargin");

    if (marginInp) marginInp.value = margin;

    const badgeMargin = document.getElementById("badgeCurrentMargin");

    if (badgeMargin) badgeMargin.textContent = `Hiá»‡n táº¡i: +${margin}%`;

    const topMarginBtn = document.getElementById("btnTopMargin");

    if (topMarginBtn) topMarginBtn.innerHTML = `<i class="fa-solid fa-percent"></i> <span>Chá»‰nh % GiÃ¡ (+${margin}%)</span>`;



    const sale = cfg.sale_campaign || {};

    document.getElementById("saleEnabled").value = String(sale.enabled !== false);

    document.getElementById("salePercent").value = sale.discount_percent || 25;

    document.getElementById("saleDurationDays").value = sale.duration_days || 5;



    // Payment

    const pay = cfg.payment || {};

    document.getElementById("bankId").value = pay.bank_id || "970454";

    document.getElementById("bankName").value = pay.bank_name || "NgÃ¢n HÃ ng Báº£n Viá»‡t (BVBank - ZaloPay)";

    document.getElementById("accountNumber").value = pay.account_number || "99ZP24261M43061759";

    document.getElementById("accountName").value = pay.account_name || "ZALOPAY_DINH TUAN HUNG";



    const tapi = pay.thueapibank || {};

    document.getElementById("thueapiToken").value = tapi.token || "498705aae1752f7c0658c6f622317daf";

    document.getElementById("thueapiPhone").value = tapi.phone || "0353680869";



    // Telegram & GitHub

    const tg = cfg.telegram || {};

    document.getElementById("tgBotToken").value = tg.bot_token || "";

    document.getElementById("tgChatId").value = tg.chat_id || "";



    const gh = cfg.github || {};

    document.getElementById("ghRepo").value = gh.repo || "cheatdth206/chungsuclienquan";

    document.getElementById("ghToken").value = gh.token || "";

  } catch (e) {

    console.error("Error loading full config:", e);

  }

}



// ==========================================

// UTILITIES

// ==========================================

function debounce(func, wait) {

  let timeout;

  return function executedFunction(...args) {

    const later = () => {

      clearTimeout(timeout);

      func(...args);

    };

    clearTimeout(timeout);

    timeout = setTimeout(later, wait);

  };

}



function showToast(message, type = "info") {

  const container = document.getElementById("adminToastContainer");

  const toast = document.createElement("div");

  toast.className = `admin-toast admin-toast-${type}`;



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







async function handleLocketLogin(e) {

  if (e) e.preventDefault();

  const email = (document.getElementById("locket_login_email") ? document.getElementById("locket_login_email").value : "").trim();

  const password = (document.getElementById("locket_login_pwd") ? document.getElementById("locket_login_pwd").value : "").trim();

  if (!email || !password) {

    showToast("Vui lÃ²ng nháº­p Email vÃ  Máº­t kháº©u Locket!", "error");

    return;

  }

  const btn = document.getElementById("btn_locket_login");

  btn.disabled = true;

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang Ä‘Äƒng nháº­p Locket...';



  try {

    const res = await fetch("/api/admin/locket/login", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ email, password })

    });

    const data = await res.json();

    if (data.success) {

      if (data.token) {

        if (document.getElementById("adv_locket_bearer")) {

          document.getElementById("adv_locket_bearer").value = data.token;

        }

      }

      showToast(data.msg || "ÄÄƒng nháº­p Locket thÃ nh cÃ´ng! ÄÃ£ tá»± Ä‘á»™ng cáº­p nháº­t Bearer Token.", "success");

    } else {

      showToast(data.msg || "ÄÄƒng nháº­p tháº¥t báº¡i!", "error");

    }

  } catch (err) {

    showToast("Lá»—i káº¿t ná»‘i: " + err.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> ÄÄƒng Nháº­p Locket & Láº¥y Token';

  }

}



async function handleImportLocketRaw() {

  const raw = (document.getElementById("locket_raw_input") ? document.getElementById("locket_raw_input").value : "").trim();

  if (!raw) {

    showToast("Vui lÃ²ng dÃ¡n gÃ³i tin HTTP Catcher hoáº·c Shadowrocket vÃ o Ã´!", "error");

    return;

  }

  const btn = document.getElementById("btnImportLocketRaw");

  btn.disabled = true;

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang bÃ³c tÃ¡ch...';



  try {

    const res = await fetch("/api/admin/tokens/import-locket-raw", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ text: raw })

    });

    const data = await res.json();

    if (data.success) {

      if (data.locket_bearer) {

        if (document.getElementById("adv_locket_bearer")) {

          document.getElementById("adv_locket_bearer").value = data.locket_bearer;

        }

      }

      if (data.firebase_appcheck) {

        document.getElementById("locketFirebaseAppCheck").value = data.firebase_appcheck;

      }

      showToast(data.msg || "ÄÃ£ bÃ³c tÃ¡ch vÃ  lÆ°u Authorization & AppCheck thÃ nh cÃ´ng!", "success");

      document.getElementById("locket_raw_input").value = "";

    } else {

      showToast(data.msg || "BÃ³c tÃ¡ch tháº¥t báº¡i!", "error");

    }

  } catch (err) {

    showToast("Lá»—i káº¿t ná»‘i: " + err.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = '<i class="fa-solid fa-bolt"></i> BÃ³c TÃ¡ch & LÆ°u Token Locket';

  }

}





// ==========================================

// MXH SERVICES MANAGEMENT TABLE (ADMIN)

// ==========================================

let gAdminMxhServices = [];



function initAdminMxhServices() {

  loadAdminMxhServices();



  const platFilter = document.getElementById("adminMxhPlatformFilter");

  const origFilter = document.getElementById("adminMxhOriginFilter");

  const stFilter = document.getElementById("adminMxhStatusFilter");

  const searchInput = document.getElementById("adminMxhSearchInput");



  if (platFilter) platFilter.addEventListener("change", renderAdminMxhServicesTable);

  if (origFilter) origFilter.addEventListener("change", renderAdminMxhServicesTable);

  if (stFilter) stFilter.addEventListener("change", renderAdminMxhServicesTable);

  if (searchInput) searchInput.addEventListener("input", renderAdminMxhServicesTable);



  const btnBatchEnable = document.getElementById("btnAdminBatchEnableAll");

  const btnBatchDisable = document.getElementById("btnAdminBatchDisableAll");



  if (btnBatchEnable) {

    btnBatchEnable.addEventListener("click", () => handleBatchToggleMxhServices(true));

  }

  if (btnBatchDisable) {

    btnBatchDisable.addEventListener("click", () => handleBatchToggleMxhServices(false));

  }

}



async function loadAdminMxhServices() {

  const tbody = document.getElementById("adminMxhServicesTableBody");

  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--admin-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Äang táº£i danh sÃ¡ch dá»‹ch vá»¥...</td></tr>';



  try {

    const res = await fetch("/api/admin/mxh/services");

    const data = await res.json();

    if (data.success && data.services) {

      gAdminMxhServices = data.services;

      const countEl = document.getElementById("mxhTotalServicesCount");

      if (countEl) countEl.textContent = gAdminMxhServices.length;

      renderAdminMxhServicesTable();

    } else {

      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#ef4444;">KhÃ´ng thá»ƒ táº£i danh sÃ¡ch dá»‹ch vá»¥.</td></tr>';

    }

  } catch (err) {

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#ef4444;">Lá»—i káº¿t ná»‘i: ${err.message}</td></tr>`;

  }

}



function getFilteredAdminMxhServices() {

  const plat = (document.getElementById("adminMxhPlatformFilter") ? document.getElementById("adminMxhPlatformFilter").value : "all");

  const orig = (document.getElementById("adminMxhOriginFilter") ? document.getElementById("adminMxhOriginFilter").value : "all");

  const status = (document.getElementById("adminMxhStatusFilter") ? document.getElementById("adminMxhStatusFilter").value : "all");

  const query = (document.getElementById("adminMxhSearchInput") ? document.getElementById("adminMxhSearchInput").value.trim().toLowerCase() : "");



  return gAdminMxhServices.filter(s => {

    // 1. Platform

    if (plat !== "all") {

      const sPlat = String(s.platform || "").toLowerCase();

      if (sPlat !== plat) return false;

    }

    // 2. Origin (Viá»‡t vs TÃ¢y)

    if (orig !== "all") {

      const sOrig = s.origin || "tay";

      if (sOrig !== orig) return false;

    }

    // 3. Status

    if (status !== "all") {

      const isActive = s.active !== false;

      if (status === "active" && !isActive) return false;

      if (status === "inactive" && isActive) return false;

    }

    // 4. Search query

    if (query) {

      const full = (String(s.id || "") + " " + String(s.service_id || "") + " " + String(s.name || "") + " " + String(s.category || "")).toLowerCase();

      if (!full.includes(query)) return false;

    }

    return true;

  });

}



function renderAdminMxhServicesTable() {

  const tbody = document.getElementById("adminMxhServicesTableBody");

  if (!tbody) return;



  const filtered = getFilteredAdminMxhServices();

  if (filtered.length === 0) {

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--admin-muted);">KhÃ´ng tÃ¬m tháº¥y dá»‹ch vá»¥ nÃ o khá»›p vá»›i bá»™ lá»c!</td></tr>';

    return;

  }



  tbody.innerHTML = filtered.map(s => {

    const sid = s.service_id || s.id;

    const isActive = s.active !== false;

    const isViet = (s.origin === "viet");

    const origBadge = isViet 

      ? '<span class="admin-badge badge-red" style="font-weight:700;"><i class="fa-solid fa-flag"></i> ðŸ‡»ðŸ‡³ Viá»‡t</span>'

      : '<span class="admin-badge badge-cyan" style="font-weight:700;"><i class="fa-solid fa-earth-americas"></i> ðŸŒ TÃ¢y</span>';



    let platBadge = `<span class="admin-badge badge-blue">${s.platform || "Other"}</span>`;

    if (s.platform === "tiktok") platBadge = '<span class="admin-badge badge-pink"><i class="fa-brands fa-tiktok"></i> TikTok</span>';

    else if (s.platform === "facebook") platBadge = '<span class="admin-badge badge-blue"><i class="fa-brands fa-facebook"></i> Facebook</span>';

    else if (s.platform === "instagram") platBadge = '<span class="admin-badge badge-purple"><i class="fa-brands fa-instagram"></i> Instagram</span>';

    else if (s.platform === "youtube") platBadge = '<span class="admin-badge badge-red"><i class="fa-brands fa-youtube"></i> YouTube</span>';



    const minQ = (s.min || 1000).toLocaleString("vi-VN");

    const maxQ = (s.max || 1000000).toLocaleString("vi-VN");



    return `

      <tr>

        <td><b style="color: #60a5fa; font-family: monospace;">#${sid}</b></td>

        <td>

          <div style="font-weight: 700; color: #fff; font-size: 0.9rem;">${s.name}</div>

          <div style="font-size: 0.78rem; color: var(--admin-muted); margin-top: 2px;">${s.category || ""}</div>

        </td>

        <td>${platBadge}</td>

        <td>${origBadge}</td>

        <td><b style="color: #facc15;">${s.price_formatted || (s.price_per_unit + "Ä‘")}</b></td>

        <td style="font-size: 0.8rem; color: var(--admin-muted);">${minQ} - ${maxQ}</td>

        <td style="text-align: center;">

          <label class="switch-toggle" style="margin: 0 auto; display: inline-block;">

            <input type="checkbox" ${isActive ? "checked" : ""} onchange="handleToggleMxhService('${sid}', this.checked)">

            <span class="slider round"></span>

          </label>

        </td>

      </tr>

    `;

  }).join("");

}



async function handleToggleMxhService(serviceId, makeActive) {

  try {

    const res = await fetch(`/api/admin/mxh/service/${serviceId}/toggle-active`, {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ active: makeActive })

    });

    const data = await res.json();

    if (data.success) {

      const item = gAdminMxhServices.find(x => String(x.id) === String(serviceId) || String(x.service_id) === String(serviceId));

      if (item) item.active = makeActive;

      showToast(makeActive ? `ÄÃ£ Báº¬T hiá»ƒn thá»‹ gÃ³i #${serviceId}` : `ÄÃ£ Táº®T gÃ³i #${serviceId}`, "success");

    } else {

      showToast(data.msg || "Lá»—i cáº­p nháº­t", "error");

      renderAdminMxhServicesTable();

    }

  } catch (err) {

    showToast("Lá»—i káº¿t ná»‘i: " + err.message, "error");

    renderAdminMxhServicesTable();

  }

}



async function handleBatchToggleMxhServices(makeActive) {

  const filtered = getFilteredAdminMxhServices();

  if (filtered.length === 0) {

    showToast("KhÃ´ng cÃ³ dá»‹ch vá»¥ nÃ o Ä‘ang Ä‘Æ°á»£c lá»c!", "warning");

    return;

  }

  const sids = filtered.map(s => String(s.service_id || s.id));

  const confirmMsg = `Báº¡n cÃ³ cháº¯c muá»‘n ${makeActive ? "Báº¬T" : "Táº®T"} ${sids.length} gÃ³i dá»‹ch vá»¥ Ä‘ang lá»c?`;

  if (!confirm(confirmMsg)) return;



  try {

    const res = await fetch("/api/admin/mxh/services/batch-toggle", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ service_ids: sids, active: makeActive })

    });

    const data = await res.json();

    if (data.success) {

      filtered.forEach(s => s.active = makeActive);

      showToast(data.msg || "ÄÃ£ cáº­p nháº­t hÃ ng loáº¡t!", "success");

      renderAdminMxhServicesTable();

    } else {

      showToast(data.msg || "Lá»—i cáº­p nháº­t", "error");

    }

  } catch (err) {

    showToast("Lá»—i káº¿t ná»‘i: " + err.message, "error");

  }

}



// ==========================================

// MOBILE NAVIGATION DRAWER & BOTTOM BAR

// ==========================================

function openMobileSidebar() {

  const sb = document.getElementById("adminSidebar");

  const bd = document.getElementById("sidebarBackdrop");

  if (sb) sb.classList.add("mobile-open");

  if (bd) bd.classList.add("active");

  document.body.style.overflow = "hidden";

}



function closeMobileSidebar() {

  const sb = document.getElementById("adminSidebar");

  const bd = document.getElementById("sidebarBackdrop");

  if (sb) sb.classList.remove("mobile-open");

  if (bd) bd.classList.remove("active");

  document.body.style.overflow = "";

}



function initMobileNav() {

  const toggleBtn = document.getElementById("btnSidebarToggle");

  const closeBtn = document.getElementById("btnSidebarClose");

  const backdrop = document.getElementById("sidebarBackdrop");

  const bottomMenuBtn = document.getElementById("btnBottomNavMenu");



  if (toggleBtn) toggleBtn.addEventListener("click", openMobileSidebar);

  if (closeBtn) closeBtn.addEventListener("click", closeMobileSidebar);

  if (backdrop) backdrop.addEventListener("click", closeMobileSidebar);

  if (bottomMenuBtn) bottomMenuBtn.addEventListener("click", openMobileSidebar);



  // Bottom nav tab buttons click handler

  document.querySelectorAll(".admin-mobile-nav-btn[data-tab]").forEach(btn => {

    btn.addEventListener("click", () => {

      const target = btn.dataset.tab;

      switchToTab(target);

    });

  });



  // Close drawer on Escape key

  document.addEventListener("keydown", (e) => {

    if (e.key === "Escape") closeMobileSidebar();

  });

}





// ==========================================

// CHá»¢ PREMIUM ADMIN LOGIC

// ==========================================

let gCurrentDelivOid = null;

let gCurrentDelivTarget = null;

let gAdminPremiumConfig = null;



function renderPremiumOrdersTable(orders) {

  const tbody = document.getElementById("tbodyOrdersPremium") || document.getElementById("prOrdersTableBody");

  if (!tbody) return;

  tbody.innerHTML = "";



  if (orders.length === 0) {

    tbody.innerHTML = `<tr><td colspan="9" class="text-center">Không có đơn hàng nào</td></tr>`;

    return;

  }



  orders.forEach(o => {

    const tr = document.createElement("tr");

    const st = (o.status || "PENDING").toUpperCase();

    let statusClass = "status-pending";

    if (st === "COMPLETED") statusClass = "status-completed";

    if (st === "PROCESSING" || st === "PAID") statusClass = "status-processing";

    if (st === "FAILED") statusClass = "status-failed";



    const plat = (o.platform || "").toLowerCase();

    let platBadge = "";

    if (plat === "youtube") {

      platBadge = `<span class="admin-status-pill" style="background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.3);"><i class="fa-brands fa-youtube"></i> YouTube</span>`;

    } else if (plat === "spotify") {

      platBadge = `<span class="admin-status-pill" style="background:rgba(16,185,129,0.15);color:#10b981;border-color:rgba(16,185,129,0.3);"><i class="fa-brands fa-spotify"></i> Spotify</span>`;

    } else if (plat === "netflix") {

      platBadge = `<span class="admin-status-pill" style="background:rgba(229,9,20,0.15);color:#e50914;border-color:rgba(229,9,20,0.3);"><i class="fa-solid fa-film"></i> Netflix</span>`;

    } else {

      const svcCfg = (gAdminPremiumConfig && gAdminPremiumConfig[plat]) || {};

      const pColor = svcCfg.color || "#38bdf8";

      const pIcon = svcCfg.icon || "fa-solid fa-gem";

      const pName = svcCfg.name || o.platform_name || plat.toUpperCase();

      platBadge = `<span class="admin-status-pill" style="background:${pColor}20;color:${pColor};border-color:${pColor}40;"><i class="${pIcon}"></i> ${pName}</span>`;

    }



    const targetDisplay = o.target ? `

      <code>${o.target}</code>

      <button class="code-copy-btn" onclick="copyToClipboard('${o.target}', 'ÄÃ£ copy tÃ i khoáº£n!')" title="Copy"><i class="fa-solid fa-copy"></i></button>

      ${o.note ? `<br><small class="text-dim">Note: ${o.note}</small>` : ''}

    ` : '<span class="text-dim">KhÃ´ng cÃ³</span>';



    const deliveryStatus = o.delivery_info ? `

      <span class="text-green" style="font-weight:700; cursor:pointer;" onclick="openDeliveryModal('${o.order_id}', '${o.platform_name || ''}', '${o.package_name || ''}', '${o.target || ''}', '${o.delivery_info.replace(/'/g, "\\'")}')" title="Báº¥m Ä‘á»ƒ xem/sá»­a thÃ´ng tin bÃ n giao">

        <i class="fa-solid fa-circle-check"></i> ÄÃ£ cáº¥p

      </span>

    ` : `<span class="text-dim">ChÆ°a cáº¥p</span>`;



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="MÃ£ ÄÆ¡n"><strong>#${o.order_id}</strong></td>

      <td data-label="Ná»n Táº£ng">${platBadge}</td>

      <td data-label="GÃ³i Mua"><strong>${o.package_name || "-"}</strong><br><small class="text-cyan">${o.duration || ""}</small></td>

      <td data-label="TÃ i Khoáº£n">${targetDisplay}</td>

      <td data-label="Sá»‘ Zalo"><code>${o.zalo || "N/A"}</code></td>

      <td data-label="Sá»‘ Tiá»n"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "Ä‘")}</strong></td>

      <td data-label="Tráº¡ng ThÃ¡i"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thá»i Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="BÃ n Giao">${deliveryStatus}</td>

      <td data-label="Thao TÃ¡c">

        <div class="action-buttons-cell">

          ${st === "PENDING" ? `<button class="btn-sm btn-accept" onclick="acceptOrder('${o.order_id}')" title="Duyá»‡t Ä‘Æ¡n"><i class="fa-solid fa-check"></i> Duyá»‡t</button>` : ""}

          <button class="btn-sm btn-push" onclick="openDeliveryModal('${o.order_id}', '${o.platform_name || ''}', '${o.package_name || ''}', '${o.target || ''}', '${(o.delivery_info || '').replace(/'/g, "\\'")}')" title="BÃ n giao tÃ i khoáº£n"><i class="fa-solid fa-key"></i> BÃ n Giao</button>

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="HoÃ n thÃ nh"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="XÃ³a Ä‘Æ¡n"><i class="fa-solid fa-trash"></i> XÃ³a</button>

        </div>

      </td>

    `;

    if (o.package_desc) {

      const packageCell = tr.querySelector('[data-label="GÃ³i Mua"]');

      const description = document.createElement("small");

      description.className = "text-dim";

      description.textContent = o.package_desc;

      packageCell?.appendChild(description);

    }

    tbody.appendChild(tr);

  });

}



function openDeliveryModal(oid, platName, pkgName, target, existingContent = "") {

  gCurrentDelivOid = oid;

  gCurrentDelivTarget = target;



  const modal = document.getElementById("modalDeliveryInfo");

  if (!modal) return;



  document.getElementById("delivModalOid").textContent = oid;

  document.getElementById("delivModalPlat").textContent = platName || "Premium";

  document.getElementById("delivModalPkg").textContent = pkgName || "GÃ³i";

  document.getElementById("delivModalTarget").textContent = target || "N/A";

  document.getElementById("delivModalContent").value = existingContent || "";



  modal.style.display = "flex";

}



function closeDeliveryModal() {

  const modal = document.getElementById("modalDeliveryInfo");

  if (modal) modal.style.display = "none";

  gCurrentDelivOid = null;

  gCurrentDelivTarget = null;

}



function setDeliveryTemplate(type) {

  const target = gCurrentDelivTarget || "email_cua_ban@gmail.com";

  const textarea = document.getElementById("delivModalContent");

  if (!textarea) return;



  if (type === "yt") {

    textarea.value = `ÄÃ£ gá»­i lá»i má»i YouTube Premium vÃ o Gmail: ${target}\nBáº¡n má»Ÿ á»©ng dá»¥ng Gmail trÃªn Ä‘iá»‡n thoáº¡i, báº¥m vÃ o thÆ° má»i tá»« Google Family vÃ  nháº¥n \"Cháº¥p nháº­n lá»i má»i\" lÃ  YouTube Premium Ä‘Æ°á»£c kÃ­ch hoáº¡t thÃ nh cÃ´ng trá»n gÃ³i!`;

  } else if (type === "sp") {

    textarea.value = `ÄÃ£ gia háº¡n tÃ i khoáº£n Spotify Premium thÃ nh cÃ´ng cho: ${target}\nBáº¡n má»Ÿ app Spotify trÃªn thiáº¿t bá»‹ cá»§a mÃ¬nh vÃ  thÆ°á»Ÿng thá»©c Ã¢m thanh 320kbps khÃ´ng quáº£ng cÃ¡o nhÃ©!`;

  } else if (type === "nf") {

    textarea.value = `TÃ i khoáº£n Netflix: ${target}\nMáº­t kháº©u: NetflixVip@2026\nProfile riÃªng: KhÃ¡ch HÃ ng\nMÃ£ PIN riÃªng: 2601\nCháº¥t lÆ°á»£ng Ultra HD 4K, báº£o hÃ nh 1 Ä‘á»•i 1 suá»‘t thá»i gian sá»­ dá»¥ng!`;

  }

}



async function submitDeliveryInfo() {

  if (!gCurrentDelivOid) return;

  const content = (document.getElementById("delivModalContent")?.value || "").trim();

  const btn = document.getElementById("btnSubmitDelivery");



  if (!content) {

    if (!confirm("Báº¡n chÆ°a nháº­p ná»™i dung bÃ n giao tÃ i khoáº£n. Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n hoÃ n táº¥t Ä‘Æ¡n khÃ´ng?")) return;

  }



  if (btn) btn.disabled = true;



  try {

    const res = await fetch("/api/admin/order/delivery-info", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        order_id: gCurrentDelivOid,

        delivery_info: content,

        status: "COMPLETED"

      })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || `ÄÃ£ bÃ n giao Ä‘Æ¡n #${gCurrentDelivOid}!`, "success");

      closeDeliveryModal();

      loadOrders();

      loadStats();

    } else {

      showToast(data.msg || "Lá»—i lÆ°u thÃ´ng tin", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



async function loadPremiumAdmin() {

  try {

    const res = await fetch("/api/premium/services");

    const data = await res.json();

    if (data.success && data.services) {

      gAdminPremiumConfig = data.services;



      // Update Market Status Toggle

      const toggleInput = document.getElementById("adminMarketToggleInput");

      const statusBadge = document.getElementById("adminMarketStatusBadge");

      const isEnabled = data.market_enabled !== false;



      if (toggleInput) toggleInput.checked = isEnabled;

      if (statusBadge) {

        if (isEnabled) {

          statusBadge.textContent = "ÄANG Báº¬T";

          statusBadge.style.background = "rgba(16, 185, 129, 0.2)";

          statusBadge.style.color = "#34d399";

          statusBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";

        } else {

          statusBadge.textContent = "ÄANG Táº®T";

          statusBadge.style.background = "rgba(239, 68, 68, 0.2)";

          statusBadge.style.color = "#f87171";

          statusBadge.style.borderColor = "rgba(239, 68, 68, 0.4)";

        }

      }



      renderAdminPremiumServices(data.services);

    }

  } catch (e) {

    console.error("Error loading admin premium config:", e);

  }

}



async function toggleServiceActive(sid, active) {

  try {

    const res = await fetch("/api/admin/premium/service/toggle", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ id: sid, active: active })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || (active ? "ÄÃ£ Báº¬T dá»‹ch vá»¥!" : "ÄÃ£ Táº®T (áº¨n) dá»‹ch vá»¥ khá»i trang web!"), "success");

      if (gAdminPremiumConfig && gAdminPremiumConfig[sid]) {

        gAdminPremiumConfig[sid].active = active;

      }

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ cáº­p nháº­t tráº¡ng thÃ¡i dá»‹ch vá»¥.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



async function togglePackageActive(sid, pid, active) {

  try {

    const res = await fetch("/api/admin/premium/package/toggle", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ service_id: sid, package_id: pid, active: active })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || (active ? "ÄÃ£ báº­t gÃ³i!" : "ÄÃ£ táº¯t gÃ³i!"), "success");

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ cáº­p nháº­t tráº¡ng thÃ¡i gÃ³i.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



async function toggleMarketStatus(enabled) {

  const statusBadge = document.getElementById("adminMarketStatusBadge");

  const toggleInput = document.getElementById("adminMarketToggleInput");

  if (toggleInput) toggleInput.disabled = true;



  try {

    const res = await fetch("/api/admin/premium/toggle", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ enabled: enabled })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || (enabled ? "ÄÃ£ Báº¬T Chá»£ Premium thÃ nh cÃ´ng!" : "ÄÃ£ Táº®T (áº¨n) Chá»£ Premium thÃ nh cÃ´ng!"), "success");

      if (statusBadge) {

        if (enabled) {

          statusBadge.textContent = "ÄANG Báº¬T";

          statusBadge.style.background = "rgba(16, 185, 129, 0.2)";

          statusBadge.style.color = "#34d399";

          statusBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";

        } else {

          statusBadge.textContent = "ÄANG Táº®T (áº¨N)";

          statusBadge.style.background = "rgba(239, 68, 68, 0.2)";

          statusBadge.style.color = "#f87171";

          statusBadge.style.borderColor = "rgba(239, 68, 68, 0.4)";

        }

      }

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ cáº­p nháº­t tráº¡ng thÃ¡i chá»£.", "error");

      if (toggleInput) toggleInput.checked = !enabled;

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

    if (toggleInput) toggleInput.checked = !enabled;

  } finally {

    if (toggleInput) toggleInput.disabled = false;

  }

}



function renderAdminPremiumServices(services) {

  const container = document.getElementById("adminPremiumServicesList");

  if (!container) return;

  container.innerHTML = "";



  const sids = Object.keys(services);

  if (sids.length === 0) {

    container.innerHTML = `

      <div style="text-align: center; padding: 40px; color: var(--admin-muted);">

        <i class="fa-solid fa-box-open" style="font-size: 2rem; margin-bottom: 10px;"></i>

        <p>ChÆ°a cÃ³ dá»‹ch vá»¥ nÃ o trong chá»£. HÃ£y báº¥m <strong>"+ ThÃªm Dá»‹ch Vá»¥ Má»›i"</strong> Ä‘á»ƒ báº¯t Ä‘áº§u!</p>

      </div>

    `;

    return;

  }



  sids.forEach(sid => {

    const svc = services[sid];

    const pkgs = svc.packages || {};

    const color = svc.color || "#2563eb";

    const icon = svc.icon || "fa-solid fa-gem";



    const card = document.createElement("div");

    card.className = "admin-service-block";

    card.dataset.serviceId = sid;

    card.style.cssText = `

      margin-bottom: 24px;

      background: rgba(15, 23, 42, 0.5);

      border: 1.5px solid ${color}44;

      border-radius: 16px;

      padding: 20px;

      box-shadow: 0 4px 20px rgba(0,0,0,0.25);

    `;



    card.innerHTML = `

      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 14px; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 14px;">

        <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 280px;">

          <div style="width: 44px; height: 44px; border-radius: 12px; background: ${color}22; color: ${color}; border: 1.5px solid ${color}55; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;">

            <i class="${icon}"></i>

          </div>

          <div style="flex: 1;">

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">

              <input type="text" class="admin-input svc-input-name" value="${svc.name || sid}" style="font-size: 1.1rem; font-weight: 800; color: #f8fafc; padding: 4px 8px; width: 220px;" placeholder="TÃªn dá»‹ch vá»¥...">

              <code style="background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px; color: ${color}; font-size: 0.82rem;">${sid}</code>

            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">

              <input type="text" class="admin-input svc-input-badge" value="${svc.badge || ''}" placeholder="Huy hiá»‡u (vd: ChÃ­nh Chá»§ Gmail)..." style="font-size: 0.8rem; width: 170px; padding: 2px 6px;">

              <input type="text" class="admin-input svc-input-icon" value="${icon}" placeholder="Icon class (vd: fa-brands fa-youtube)..." style="font-size: 0.8rem; width: 160px; padding: 2px 6px;">

              <input type="color" class="svc-input-color" value="${color}" style="width: 30px; height: 26px; border: none; border-radius: 4px; cursor: pointer; padding: 0;">

            </div>

          </div>

        </div>



        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">

          <label class="switch-toggle" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">

            <input type="checkbox" class="svc-input-active" ${svc.active !== false ? 'checked' : ''} onchange="toggleServiceActive('${sid}', this.checked)">

            <span class="slider round"></span>

          </label>

          <span style="font-size: 0.82rem; color: #cbd5e1; font-weight: 700;">KÃ­ch hoáº¡t</span>



          <button type="button" class="btn-sm btn-edit" onclick="openAddPackageModal('${sid}', '${svc.name}')" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-weight: 700; padding: 6px 12px; border-radius: 8px;">

            <i class="fa-solid fa-plus"></i> ThÃªm GÃ³i

          </button>



          <button type="button" class="btn-sm btn-delete" onclick="deletePremiumService('${sid}')" style="padding: 6px 12px; border-radius: 8px;">

            <i class="fa-solid fa-trash"></i> XÃ³a Dá»‹ch Vá»¥

          </button>

        </div>

      </div>



      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">

        <div>

          <label style="font-size: 0.78rem; color: #94a3b8; display: block; margin-bottom: 2px;">Kháº©u hiá»‡u (Tagline):</label>

          <input type="text" class="admin-input svc-input-tagline" value="${svc.tagline || ''}" placeholder="Kháº©u hiá»‡u hiá»ƒn thá»‹ trÃªn web..." style="width: 100%; font-size: 0.84rem;">

        </div>

        <div>

          <label style="font-size: 0.78rem; color: #94a3b8; display: block; margin-bottom: 2px;">NhÃ£n Ã´ nháº­p cá»§a khÃ¡ch:</label>

          <input type="text" class="admin-input svc-input-label" value="${svc.input_label || 'TÃ i khoáº£n / Email'}" placeholder="NhÃ£n input..." style="width: 100%; font-size: 0.84rem;">

        </div>

      </div>



      <div class="admin-table-responsive" style="margin-top: 10px;">

        <table class="admin-table" style="font-size: 0.86rem;">

          <thead>

            <tr>

              <th>MÃ£ GÃ³i</th>

              <th>TÃªn GÃ³i</th>

              <th>Thá»i Háº¡n</th>

              <th>Ghi ChÃº RiÃªng</th>

              <th>Huy Hiá»‡u</th>

              <th>GiÃ¡ BÃ¡n (VNÄ)</th>

              <th style="text-align: center;">KÃ­ch Hoáº¡t</th>

              <th style="text-align: center;">Thao TÃ¡c</th>

            </tr>

          </thead>

          <tbody class="svc-packages-tbody">

            ${renderPackagesRowsHtml(sid, pkgs)}

          </tbody>

        </table>

      </div>

    `;



    container.appendChild(card);

  });

}



function escapePackageText(value) {

  return String(value || "").replace(/[&<>"']/g, character => ({

    "&": "&amp;",

    "<": "&lt;",

    ">": "&gt;",

    '"': "&quot;",

    "'": "&#39;"

  })[character]);

}



function renderPackagesRowsHtml(sid, pkgs) {

  const pkgKeys = Object.keys(pkgs);

  if (pkgKeys.length === 0) {

    return `<tr><td colspan="8" style="text-align: center; color: var(--admin-muted); padding: 16px;">ChÆ°a cÃ³ gÃ³i nÃ o cho dá»‹ch vá»¥ nÃ y. HÃ£y báº¥m "+ ThÃªm GÃ³i" á»Ÿ trÃªn!</td></tr>`;

  }



  return pkgKeys.map(k => {

    const pkg = pkgs[k];

    return `

      <tr data-pkg-id="${k}">

        <td><code>${k}</code></td>

        <td><input type="text" class="admin-input pkg-input-name" value="${pkg.name || ''}" style="width: 100%; min-width: 150px;"></td>

        <td><input type="text" class="admin-input pkg-input-duration" value="${pkg.duration || ''}" style="width: 100px;"></td>

        <td><textarea class="admin-input pkg-input-desc" maxlength="500" rows="2" placeholder="Ghi chÃº hiá»ƒn thá»‹ cho khÃ¡ch..." style="width: 180px; resize: vertical;">${escapePackageText(pkg.desc)}</textarea></td>

        <td><input type="text" class="admin-input pkg-input-badge" value="${pkg.badge || ''}" style="width: 110px;"></td>

        <td><input type="number" class="admin-input pkg-input-price" value="${pkg.price || 0}" step="1000" style="width: 120px;"></td>

        <td style="text-align: center;">

          <label class="switch-toggle" style="display: inline-block;">

            <input type="checkbox" class="pkg-input-active" ${pkg.active !== false ? 'checked' : ''} onchange="togglePackageActive('${sid}', '${k}', this.checked)">

            <span class="slider round"></span>

          </label>

        </td>

        <td style="text-align: center;">

          <button type="button" class="btn-sm btn-delete" onclick="deletePremiumPackage('${sid}', '${k}')" title="XÃ³a gÃ³i nÃ y">

            <i class="fa-solid fa-trash"></i>

          </button>

        </td>

      </tr>

    `;

  }).join("");

}



async function saveAllPremiumServices() {

  const btn = document.getElementById("btnSaveAllPremiumPkgs");

  if (btn) btn.disabled = true;



  try {

    const container = document.getElementById("adminPremiumServicesList");

    if (!container) return;



    const serviceBlocks = container.querySelectorAll(".admin-service-block");

    const services = {};



    serviceBlocks.forEach(block => {

      const sid = block.dataset.serviceId;

      if (!sid) return;



      const oldSvc = (gAdminPremiumConfig && gAdminPremiumConfig[sid]) || {};



      const name = block.querySelector(".svc-input-name")?.value.trim() || sid;

      const badge = block.querySelector(".svc-input-badge")?.value.trim() || "";

      const icon = block.querySelector(".svc-input-icon")?.value.trim() || "fa-solid fa-gem";

      const color = block.querySelector(".svc-input-color")?.value.trim() || "#2563eb";

      const active = block.querySelector(".svc-input-active")?.checked !== false;

      const tagline = block.querySelector(".svc-input-tagline")?.value.trim() || "";

      const inputLabel = block.querySelector(".svc-input-label")?.value.trim() || "Email / TÃ i khoáº£n nháº­n";



      const pkgs = {};

      const rows = block.querySelectorAll(".svc-packages-tbody tr[data-pkg-id]");



      rows.forEach(tr => {

        const pkgId = tr.dataset.pkgId;

        const pName = tr.querySelector(".pkg-input-name")?.value.trim() || "";

        const pDuration = tr.querySelector(".pkg-input-duration")?.value.trim() || "1 ThÃ¡ng";

        const pDesc = tr.querySelector(".pkg-input-desc")?.value.trim() || "";

        const pBadge = tr.querySelector(".pkg-input-badge")?.value.trim() || "";

        const pPrice = Number(tr.querySelector(".pkg-input-price")?.value || 0);

        const pActive = tr.querySelector(".pkg-input-active")?.checked !== false;



        pkgs[pkgId] = {

          id: pkgId,

          name: pName,

          duration: pDuration,

          badge: pBadge,

          price: pPrice,

          price_formatted: pPrice.toLocaleString("vi-VN") + "Ä‘",

          active: pActive,

          desc: pDesc

        };

      });



      services[sid] = {

        ...oldSvc,

        id: sid,

        name: name,

        badge: badge,

        icon: icon,

        color: color,

        active: active,

        tagline: tagline,

        input_label: inputLabel,

        packages: pkgs

      };

    });



    const marketEnabled = document.getElementById("adminMarketToggleInput") ? document.getElementById("adminMarketToggleInput").checked : true;



    const res = await fetch("/api/admin/premium/save-all", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ services: services, market_enabled: marketEnabled })

    });



    const data = await res.json();

    if (data.success) {

      showToast("ðŸŽ‰ ÄÃ£ lÆ°u toÃ n bá»™ cáº¥u hÃ¬nh Chá»£ Premium thÃ nh cÃ´ng!", "success");

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ lÆ°u cáº¥u hÃ¬nh.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i mÃ¡y chá»§: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



// Modal ThÃªm Dá»‹ch Vá»¥ Má»›i

function openAddServiceModal() {

  const m = document.getElementById("modalAddPremiumService");

  if (m) {

    m.style.setProperty("display", "flex", "important");

  }

}



function closeAddServiceModal() {

  const m = document.getElementById("modalAddPremiumService");

  if (m) {

    m.style.setProperty("display", "none", "important");

  }

}



async function submitAddService() {

  const sid = (document.getElementById("addSvcId")?.value || "").trim().toLowerCase();

  const name = (document.getElementById("addSvcName")?.value || "").trim();

  const icon = (document.getElementById("addSvcIcon")?.value || "").trim();

  const color = (document.getElementById("addSvcColor")?.value || "").trim();

  const badge = (document.getElementById("addSvcBadge")?.value || "").trim();

  const tagline = (document.getElementById("addSvcTagline")?.value || "").trim();

  const inputLabel = (document.getElementById("addSvcInputLabel")?.value || "").trim();

  const guideNote = (document.getElementById("addSvcGuideNote")?.value || "").trim();

  const firstPkgName = (document.getElementById("addSvcPkgName")?.value || "").trim();

  const firstPkgDuration = (document.getElementById("addSvcPkgDuration")?.value || "").trim();

  const firstPkgPrice = parseInt(document.getElementById("addSvcPkgPrice")?.value || 0);



  if (!sid || !name) {

    showToast("Vui lÃ²ng nháº­p MÃ£ ID vÃ  TÃªn dá»‹ch vá»¥!", "error");

    return;

  }



  const btn = document.getElementById("btnSubmitAddSvc");

  if (btn) btn.disabled = true;



  try {

    const res = await fetch("/api/admin/premium/service/add", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        id: sid,

        name: name,

        icon: icon,

        color: color,

        badge: badge,

        tagline: tagline,

        input_label: inputLabel,

        guide_note: guideNote,

        first_pkg_name: firstPkgName,

        first_pkg_duration: firstPkgDuration,

        first_pkg_price: firstPkgPrice

      })

    });



    const data = await res.json();

    if (data.success) {

      showToast(`ðŸŽ‰ ÄÃ£ thÃªm dá»‹ch vá»¥ "${name}" thÃ nh cÃ´ng!`, "success");

      closeAddServiceModal();

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ thÃªm dá»‹ch vá»¥.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



async function deletePremiumService(sid) {

  if (!confirm(`Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n xÃ³a toÃ n bá»™ dá»‹ch vá»¥ "${sid}" vÃ  cÃ¡c gÃ³i Ä‘i kÃ¨m khÃ´ng?`)) {

    return;

  }



  try {

    const res = await fetch("/api/admin/premium/service/delete", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ id: sid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(`ÄÃ£ xÃ³a dá»‹ch vá»¥ "${sid}".`, "success");

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ xÃ³a dá»‹ch vá»¥.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



// Modal ThÃªm GÃ³i Má»›i

function openAddPackageModal(sid, svcName) {

  const m = document.getElementById("modalAddPremiumPackage");

  if (!m) return;



  const targetId = document.getElementById("addPkgTargetSvcId");

  const targetName = document.getElementById("addPkgTargetSvcName");

  if (targetId) targetId.value = sid;

  if (targetName) targetName.textContent = svcName || sid;



  const idEl = document.getElementById("addPkgId");

  if (idEl) idEl.value = `${sid}_`;

  const nameEl = document.getElementById("addPkgName");

  if (nameEl) nameEl.value = "";

  const durEl = document.getElementById("addPkgDuration");

  if (durEl) durEl.value = "1 ThÃ¡ng";

  const priceEl = document.getElementById("addPkgPrice");

  if (priceEl) priceEl.value = "99000";

  const badgeEl = document.getElementById("addPkgBadge");

  if (badgeEl) badgeEl.value = "";

  const descEl = document.getElementById("addPkgDesc");

  if (descEl) descEl.value = "";



  m.style.setProperty("display", "flex", "important");

}



function closeAddPackageModal() {

  const m = document.getElementById("modalAddPremiumPackage");

  if (m) {

    m.style.setProperty("display", "none", "important");

  }

}



async function submitAddPackage() {

  const sid = (document.getElementById("addPkgTargetSvcId")?.value || "").trim();

  const pkgId = (document.getElementById("addPkgId")?.value || "").trim();

  const name = (document.getElementById("addPkgName")?.value || "").trim();

  const duration = (document.getElementById("addPkgDuration")?.value || "").trim();

  const price = Number(document.getElementById("addPkgPrice")?.value || 0);

  const badge = (document.getElementById("addPkgBadge")?.value || "").trim();

  const desc = (document.getElementById("addPkgDesc")?.value || "").trim();



  if (!sid || !pkgId || !name || !Number.isInteger(price) || price <= 0) {

    showToast("Vui lÃ²ng Ä‘iá»n Ä‘á»§ MÃ£ gÃ³i, TÃªn gÃ³i vÃ  GiÃ¡ há»£p lá»‡ (>0)!", "error");

    return;

  }

  if (!/^[a-z0-9_-]{1,64}$/.test(pkgId)) {

    showToast("MÃ£ gÃ³i chá»‰ gá»“m chá»¯ thÆ°á»ng, sá»‘, dáº¥u '-' hoáº·c '_' (tá»‘i Ä‘a 64 kÃ½ tá»±).", "error");

    return;

  }



  const btn = document.getElementById("btnSubmitAddPkg");

  if (btn) btn.disabled = true;



  try {

    const res = await fetch("/api/admin/premium/package/add", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        service_id: sid,

        id: pkgId,

        name: name,

        duration: duration,

        price: price,

        badge: badge,

        desc: desc

      })

    });



    const data = await res.json();

    if (data.success) {

      showToast(`ÄÃ£ thÃªm gÃ³i "${name}"!`, "success");

      closeAddPackageModal();

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ thÃªm gÃ³i.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



async function deletePremiumPackage(sid, pkgId) {

  if (!confirm(`Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n xÃ³a gÃ³i "${pkgId}" khá»i dá»‹ch vá»¥ "${sid}"?`)) {

    return;

  }



  try {

    const res = await fetch("/api/admin/premium/package/delete", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ service_id: sid, package_id: pkgId })

    });

    const data = await res.json();

    if (data.success) {

      showToast(`ÄÃ£ xÃ³a gÃ³i "${pkgId}".`, "success");

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "KhÃ´ng thá»ƒ xÃ³a gÃ³i.", "error");

    }

  } catch (e) {

    showToast("Lá»—i káº¿t ná»‘i: " + e.message, "error");

  }

}



function filterOrdersPremium() {

  loadOrders("premium");

}

window.filterOrdersPremium = filterOrdersPremium;



// ==========================================
// POPUP ANNOUNCEMENT ADMIN MANAGEMENT (Cyber-Kawaii Glassmorphic Real-Time)
// ==========================================

function getAnnouncementElems() {
  const toggle = document.getElementById("togglePopupAnnouncement") || document.getElementById("popup-active") || document.getElementById("toggleAnnouncement");
  const toggleAlias = document.getElementById("popup-active");
  const badge = document.getElementById("popupStatusBadge") || document.getElementById("announcementStatusBadge");
  const title = document.getElementById("popupTitleInput") || document.getElementById("popup-title") || document.getElementById("announcementTitleInput");
  const titleAlias = document.getElementById("popup-title");
  const content = document.getElementById("popupContentInput") || document.getElementById("popup-content") || document.getElementById("announcementContentInput");
  const contentAlias = document.getElementById("popup-content");
  const updated = document.getElementById("popupLastUpdated") || document.getElementById("announcementLastUpdated");
  const btnSave = document.getElementById("btnSavePopupAnnouncement") || document.getElementById("btnSaveAnnouncement");
  const btnClear = document.getElementById("btnClearPopupAnnouncement") || document.getElementById("btnClearAnnouncement");
  const btnPreview = document.getElementById("btnPreviewPopupAnnouncement") || document.getElementById("btnPreviewAnnouncement");
  const liveTitle = document.getElementById("panelLivePreviewTitle") || document.getElementById("adminPreviewTitle");
  const liveContent = document.getElementById("panelLivePreviewContent") || document.getElementById("adminPreviewContent");

  return {
    toggle,
    toggleAlias,
    badge,
    title,
    titleAlias,
    content,
    contentAlias,
    updated,
    btnSave,
    btnClear,
    btnPreview,
    liveTitle,
    liveContent
  };
}

function updateAnnouncementLivePreview(titleText, contentText) {
  const defaultTitle = "🎉 THÔNG BÁO TỪ HỆ THỐNG";
  const defaultContent = "Chào mừng bạn đến với DTH Services! Chúc bạn một ngày tốt lành.";

  const finalTitle = (titleText && titleText.trim()) ? titleText.trim() : defaultTitle;
  const finalContent = (contentText && contentText.trim()) ? contentText.trim() : defaultContent;

  const panelLiveTitle = document.getElementById("panelLivePreviewTitle");
  const panelLiveContent = document.getElementById("panelLivePreviewContent");
  const modalPreviewTitle = document.getElementById("adminPreviewTitle");
  const modalPreviewContent = document.getElementById("adminPreviewContent");

  if (panelLiveTitle) panelLiveTitle.textContent = finalTitle;
  if (panelLiveContent) panelLiveContent.textContent = finalContent;
  if (modalPreviewTitle) modalPreviewTitle.textContent = finalTitle;
  if (modalPreviewContent) modalPreviewContent.textContent = finalContent;
}

async function loadPopupAnnouncement() {
  try {
    const res = await fetch("/api/admin/announcement");
    const json = await res.json();
    if (!json.success) return;
    const ann = json.data || json.announcement || {};

    const elems = getAnnouncementElems();

    const isEnabled = Boolean(ann.enabled);
    if (elems.toggle) elems.toggle.checked = isEnabled;
    if (elems.toggleAlias) elems.toggleAlias.checked = isEnabled;

    if (elems.badge) {
      elems.badge.textContent = isEnabled ? "ĐANG BẬT" : "ĐÃ TẮT";
      elems.badge.style.color = isEnabled ? "#34d399" : "#f87171";
      elems.badge.style.background = isEnabled ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)";
    }

    const tVal = ann.title || "";
    if (elems.title) elems.title.value = tVal;
    if (elems.titleAlias) elems.titleAlias.value = tVal;

    const cVal = ann.content || "";
    if (elems.content) elems.content.value = cVal;
    if (elems.contentAlias) elems.contentAlias.value = cVal;

    if (elems.updated && ann.updated_at) {
      const d = new Date(ann.updated_at * 1000);
      elems.updated.textContent = d.toLocaleString("vi-VN");
    }

    updateAnnouncementLivePreview(tVal, cVal);
  } catch (err) {
    console.error("Lỗi tải popup announcement:", err);
  }
}

async function savePopupAnnouncement() {
  const elems = getAnnouncementElems();
  if (elems.btnSave) {
    elems.btnSave.disabled = true;
    elems.btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
  }
  try {
    const enabled = elems.toggle ? elems.toggle.checked : (elems.toggleAlias ? elems.toggleAlias.checked : true);
    const titleVal = elems.title ? elems.title.value : (elems.titleAlias ? elems.titleAlias.value : "");
    const contentVal = elems.content ? elems.content.value : (elems.contentAlias ? elems.contentAlias.value : "");

    const payload = {
      action: "save",
      enabled: enabled,
      title: titleVal,
      content: contentVal
    };
    const res = await fetch("/api/admin/announcement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      if (typeof showToast === "function") {
        showToast("Đã lưu cấu hình Popup Thông Báo thành công!", "success");
      }
      await loadPopupAnnouncement();
    } else {
      if (typeof showToast === "function") {
        showToast(data.msg || "Không thể lưu cấu hình popup.", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Lỗi khi lưu popup: " + err.message, "error");
    }
  } finally {
    if (elems.btnSave) {
      elems.btnSave.disabled = false;
      elems.btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 💾 Lưu Cấu Hình';
    }
  }
}

async function clearPopupAnnouncement() {
  if (!confirm("Bạn có chắc chắn muốn xóa sạch nội dung Popup Thông Báo và tắt hiển thị?")) {
    return;
  }
  const elems = getAnnouncementElems();
  if (elems.btnClear) {
    elems.btnClear.disabled = true;
    elems.btnClear.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xóa...';
  }
  try {
    const res = await fetch("/api/admin/announcement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof showToast === "function") {
        showToast("Đã xóa sạch nội dung thông báo & tắt popup!", "info");
      }
      if (elems.title) elems.title.value = "";
      if (elems.titleAlias) elems.titleAlias.value = "";
      if (elems.content) elems.content.value = "";
      if (elems.contentAlias) elems.contentAlias.value = "";
      if (elems.toggle) elems.toggle.checked = false;
      if (elems.toggleAlias) elems.toggleAlias.checked = false;
      if (elems.badge) {
        elems.badge.textContent = "ĐÃ TẮT";
        elems.badge.style.color = "#f87171";
        elems.badge.style.background = "rgba(239, 68, 68, 0.2)";
      }
      updateAnnouncementLivePreview("", "");
      await loadPopupAnnouncement();
    } else {
      if (typeof showToast === "function") {
        showToast(data.msg || "Lỗi xóa thông báo.", "error");
      }
    }
  } catch (err) {
    if (typeof showToast === "function") {
      showToast("Lỗi: " + err.message, "error");
    }
  } finally {
    if (elems.btnClear) {
      elems.btnClear.disabled = false;
      elems.btnClear.innerHTML = '<i class="fa-solid fa-trash-can"></i> ❌ Xóa Sạch Nội Dung & Tắt';
    }
  }
}

function previewPopupAnnouncement() {
  const elems = getAnnouncementElems();
  const titleVal = (elems.title && elems.title.value.trim()) ? elems.title.value.trim() : ((elems.titleAlias && elems.titleAlias.value.trim()) ? elems.titleAlias.value.trim() : "🎉 THÔNG BÁO TỪ HỆ THỐNG");
  const contentVal = (elems.content && elems.content.value.trim()) ? elems.content.value.trim() : ((elems.contentAlias && elems.contentAlias.value.trim()) ? elems.contentAlias.value.trim() : "Chào mừng bạn đến với DTH Services! Chúc bạn một ngày tốt lành.");

  updateAnnouncementLivePreview(titleVal, contentVal);

  const modal = document.getElementById("modalAdminPopupPreview");
  if (modal) {
    modal.style.display = "flex";
  } else {
    const liveBox = document.getElementById("panelLivePreviewTitle");
    if (liveBox) {
      liveBox.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

function initAnnouncementAdmin() {
  const elems = getAnnouncementElems();

  if (elems.btnSave) {
    elems.btnSave.onclick = savePopupConfig;
    elems.btnSave.addEventListener("click", savePopupConfig);
  }
  if (elems.btnClear) {
    elems.btnClear.onclick = clearPopupConfig;
    elems.btnClear.addEventListener("click", clearPopupConfig);
  }
  if (elems.btnPreview) {
    elems.btnPreview.onclick = previewPopupConfig;
    elems.btnPreview.addEventListener("click", previewPopupConfig);
  }

  // Real-time live typing preview and input bidirectional sync
  if (elems.title) {
    elems.title.addEventListener("input", () => {
      if (elems.titleAlias) elems.titleAlias.value = elems.title.value;
      const curContent = elems.content ? elems.content.value : (elems.contentAlias ? elems.contentAlias.value : "");
      updateAnnouncementLivePreview(elems.title.value, curContent);
    });
  }
  if (elems.titleAlias) {
    elems.titleAlias.addEventListener("input", () => {
      if (elems.title) elems.title.value = elems.titleAlias.value;
      const curContent = elems.content ? elems.content.value : (elems.contentAlias ? elems.contentAlias.value : "");
      updateAnnouncementLivePreview(elems.titleAlias.value, curContent);
    });
  }
  if (elems.content) {
    elems.content.addEventListener("input", () => {
      if (elems.contentAlias) elems.contentAlias.value = elems.content.value;
      const curTitle = elems.title ? elems.title.value : (elems.titleAlias ? elems.titleAlias.value : "");
      updateAnnouncementLivePreview(curTitle, elems.content.value);
    });
  }
  if (elems.contentAlias) {
    elems.contentAlias.addEventListener("input", () => {
      if (elems.content) elems.content.value = elems.contentAlias.value;
      const curTitle = elems.title ? elems.title.value : (elems.titleAlias ? elems.titleAlias.value : "");
      updateAnnouncementLivePreview(curTitle, elems.contentAlias.value);
    });
  }

  // Toggle switch live badge update
  const handleToggleChange = (isChecked) => {
    if (elems.toggle) elems.toggle.checked = isChecked;
    if (elems.toggleAlias) elems.toggleAlias.checked = isChecked;
    const badge = elems.badge;
    if (badge) {
      badge.textContent = isChecked ? "ĐANG BẬT" : "ĐÃ TẮT";
      badge.style.color = isChecked ? "#34d399" : "#f87171";
      badge.style.background = isChecked ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)";
    }
  };

  if (elems.toggle) {
    elems.toggle.addEventListener("change", () => handleToggleChange(elems.toggle.checked));
  }
  if (elems.toggleAlias) {
    elems.toggleAlias.addEventListener("change", () => handleToggleChange(elems.toggleAlias.checked));
  }

  loadPopupConfig();
}

// Global exports & backward-compatibility aliases
window.loadPopupConfig = loadPopupAnnouncement;
window.savePopupConfig = savePopupAnnouncement;
window.clearPopupConfig = clearPopupAnnouncement;
window.previewPopupConfig = previewPopupAnnouncement;

window.loadPopupAnnouncement = loadPopupAnnouncement;
window.savePopupAnnouncement = savePopupAnnouncement;
window.clearPopupAnnouncement = clearPopupAnnouncement;
window.previewPopupAnnouncement = previewPopupAnnouncement;

window.initAnnouncementAdmin = initAnnouncementAdmin;
window.switchToTab = switchToTab;
window.switchTab = switchToTab;
