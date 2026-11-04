/**

 * DTH Portal - Unified Admin JavaScript

 * Powers Dashboard stats, Orders management, and settings for Chung Sức, Locket Gold, MXH, Banking & Telegram.

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
  const timeoutId = setTimeout(() => controller.abort(), 10000);

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
    const message = error.name === "AbortError"
      ? "quá thời gian chờ"
      : (error.message || "không rõ nguyên nhân");
    element.textContent = `Lỗi kết nối / Chưa cấu hình API: ${message}`;
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

    dashboard: "Bảng Điều Khiển Tổng Quan",

    "orders-chungsuc": "Quản Lý Đơn Chung Sức Liên Quân (AutoNhanh)",

    "orders-locket": "Quản Lý Đơn Nâng Cấp Locket Gold iOS",

    "orders-mxh": "Quản Lý Đơn Mạng Xã Hội (TangTim API)",

    "orders-premium": "Quản Lý Đơn Chợ Premium (YouTube, Spotify, Netflix)",

    premium: "Cài Đặt Bảng Giá Chợ Premium",

    chungsuc: "Cài Đặt Sự Kiện Chung Sức Liên Quân",

    locket: "Cài Đặt & Quản Lý Locket Gold",

    mxh: "Cài Đặt Dịch Vụ Mạng Xã Hội (TangTim)",

    payment: "Cài Đặt Ngân Hàng & Auto Quét ThueAPIBank",

    announcement: "Quản Lý Popup Thông Báo Khách Hàng",
    popup: "Quản Lý Popup Thông Báo Khách Hàng",
    "popup-announcement": "Quản Lý Popup Thông Báo Khách Hàng",
    "popup-thong-bao": "Quản Lý Popup Thông Báo Khách Hàng",
    settings: "Cài Đặt Hệ Thống, Telegram & GitHub"

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

    titleElem.textContent = titles[target] || "Quản Trị Hệ Thống";

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



    document.getElementById("statTotalRev").textContent = data.total_revenue_formatted || "0đ";

    document.getElementById("statTodayRev").textContent = data.today_revenue_formatted || "0đ";

    document.getElementById("statTotalOrders").textContent = data.counts.all || 0;

    document.getElementById("statPendingOrders").textContent = data.status_counts.PENDING || 0;



    // Service Breakdown

    document.getElementById("bdCsOrders").textContent = `${data.counts.chungsuc || 0} đơn`;

    document.getElementById("bdCsRev").textContent = (data.rev_by_type.chungsuc || 0).toLocaleString("vi-VN") + "đ";



    document.getElementById("bdLkOrders").textContent = `${data.counts.locket || 0} đơn`;

    document.getElementById("bdLkRev").textContent = (data.rev_by_type.locket || 0).toLocaleString("vi-VN") + "đ";



    document.getElementById("bdMxhOrders").textContent = `${data.counts.mxh || 0} đơn`;

    document.getElementById("bdMxhRev").textContent = (data.rev_by_type.mxh || 0).toLocaleString("vi-VN") + "đ";



    const bdPrOrders = document.getElementById("bdPrOrders");

    const bdPrRev = document.getElementById("bdPrRev");

    if (bdPrOrders) bdPrOrders.textContent = `${data.counts.premium || 0} đơn`;

    if (bdPrRev) bdPrRev.textContent = (data.rev_by_type.premium || 0).toLocaleString("vi-VN") + "đ";



  } catch (e) {

    console.error("Error loading stats:", e);

  }

}



async function triggerBankScan() {

  const btn = document.getElementById("btnTopScanBank");

  btn.disabled = true;

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...`;



  try {

    const res = await fetch("/api/admin/check-bank", { method: "POST" });

    const data = await res.json();

    if (data.matched && data.matched.length > 0) {

      showToast(`🎉 Khớp thành công ${data.matched.length} đơn hàng: ${data.matched.join(", ")}`, "success");

      loadOrders();

      loadStats();

    } else {

      showToast(data.msg || "Đã quét ngân hàng. Không có giao dịch mới khớp.", "info");

    }

  } catch (e) {

    showToast("Lỗi quét ngân hàng: " + e.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = `<i class="fa-solid fa-rotate"></i> <span>Quét Ngân Hàng Ngay</span>`;

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

    showToast(msg || "Đã sao chép vào bộ nhớ tạm!", "success");

  }).catch(() => {

    showToast("Không thể sao chép!", "error");

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



    // Phân loại riêng từng dịch vụ

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



    // Cập nhật số lượng huy hiệu trên Sidebar & Nav Tabs

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



    // 1. Render Bảng Chung Sức Liên Quân

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



    // 2. Render Bảng Locket Gold

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



    // 3. Render Bảng Mạng Xã Hội

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



    // 4. Render Bảng Chợ Premium

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



// Bảng 1: Chung Sức Liên Quân

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

      ? `<code style="color: #facc15;">${code}</code> <button class="code-copy-btn" onclick="copyToClipboard('${code}', 'Đã copy mã LQ!')"><i class="fa-solid fa-copy"></i></button>`

      : '<span class="text-dim">Không có</span>';



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="Mã Đơn"><strong>#${o.order_id}</strong></td>

      <td data-label="Mã Mời">${codeDisplay}</td>

      <td data-label="Gói Đơn"><strong>${o.package_name || "Buff Lượt LQ"}</strong></td>

      <td data-label="Số Zalo"><code>${o.zalo || "N/A"}</code></td>

      <td data-label="Số Tiền"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "đ")}</strong></td>

      <td data-label="Trạng Thái"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thời Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="Tiến Độ"><small>${partnerLog}</small></td>

      <td data-label="Thao Tác">

        <div class="action-buttons-cell">

          ${st === "PENDING" ? `<button class="btn-sm btn-accept" onclick="acceptOrder('${o.order_id}')" title="Duyệt & Đẩy"><i class="fa-solid fa-check"></i> Duyệt</button>` : ""}

          <button class="btn-sm btn-edit" onclick="adminEditTarget('${o.order_id}', '${code}', 'code')" title="Sửa mã mời"><i class="fa-solid fa-pen"></i> Sửa</button>

          <button class="btn-sm btn-push" onclick="pushOrder('${o.order_id}')" title="Đẩy lại"><i class="fa-solid fa-paper-plane"></i> Đẩy</button>

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="Hoàn thành"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="Xóa đơn"><i class="fa-solid fa-trash"></i> Xóa</button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



// Bảng 2: Locket Gold

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

      <td data-label="Mã Đơn"><strong>#${o.order_id}</strong></td>

      <td data-label="Khách Hàng">

        <div style="display: flex; align-items: center; gap: 8px;">

          <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1.5px solid #ec4899;" onerror="this.src='https://play-lh.googleusercontent.com/eRZLg00mAQGayCrFjDBklPIpW3qFHcmUs8PUQA4z7hVe-cDKMcRqecVHONAIexJGJZM'">

          <div>

            <strong style="color: #f472b6;">@${user || "N/A"}</strong>

            ${o.display_name ? `<br><small class="text-dim">${o.display_name}</small>` : ""}

          </div>

        </div>

      </td>

      <td data-label="Gói Đơn"><strong>${o.package_name || "Locket Gold"}</strong></td>

      <td data-label="UID"><code style="font-size: 0.78rem;">${o.uid || "-"}</code></td>

      <td data-label="Số Zalo"><code>${o.zalo || "N/A"}</code></td>

      <td data-label="Số Tiền"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "đ")}</strong></td>

      <td data-label="Trạng Thái"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thời Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="Thao Tác">

        <div class="action-buttons-cell">

          ${user ? `<button class="btn-sm btn-reup-gold" onclick="reupGoldCustomer('${user}', '${o.order_id}')" title="Lên lại Gold cho khách cũ"><i class="fa-solid fa-rotate-right"></i> Lên Lại Gold</button>` : ""}

          ${user ? `<button class="btn-sm btn-accept" onclick="quickGrantGold('${user}', '${o.order_id}')" title="Kích hoạt Gold VIP"><i class="fa-solid fa-crown"></i> Kích Hoạt</button>` : ""}

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="Hoàn thành"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="Xóa đơn"><i class="fa-solid fa-trash"></i> Xóa</button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



async function reupGoldCustomer(username, oid) {

  if (!confirm(`Xác nhận LÊN LẠI GOLD VIP cho khách cũ @${username} (Mã đơn #${oid})?`)) return;

  showToast(`Đang lên lại Gold cho @${username}...`, "info");

  try {

    const res = await fetch("/api/admin/locket/reup-gold", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ username: username, order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || `Đã lên lại Gold thành công cho @${username}!`, "success");

      loadAdminOrders("locket");

    } else {

      showToast(data.msg || "Lỗi khi lên lại Gold.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

  }

}



async function quickGrantGold(username, oid) {

  if (!confirm(`Xác nhận kích hoạt Gold ngay cho tài khoản @${username}?`)) return;

  try {

    const res = await fetch("/api/admin/locket/manual-grant", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ username, order_id: oid })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || `Đã gửi lệnh kích hoạt Gold cho @${username}!`, "success");

      loadOrders();

    } else {

      showToast(data.msg || "Kích hoạt thất bại", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  }

}



// Bảng 3: Mạng Xã Hội

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

      : '<span class="text-dim">Không có link</span>';



    const qty = o.quantity ? Number(o.quantity).toLocaleString() : (o.count || "-");



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="Mã Đơn"><strong>#${o.order_id}</strong></td>

      <td data-label="Dịch Vụ">

        <span class="admin-badge badge-blue" style="margin-bottom: 4px; display: inline-flex; align-items: center; gap: 4px;">${platIcon} ${platName}</span><br>

        <strong>${o.package_name || o.service_name || "Dịch vụ MXH"}</strong>

      </td>

      <td data-label="Link / Zalo">${linkEl}<br><small class="text-dim">Zalo: ${o.zalo || "N/A"}</small></td>

      <td data-label="Số Lượng"><strong class="text-cyan">${qty}</strong></td>

      <td data-label="Số Tiền"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "đ")}</strong></td>

      <td data-label="Trạng Thái"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thời Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="Mã Máy Chủ"><small>${o.tangtim_order_id ? `<span class="text-cyan">ID #${o.tangtim_order_id}</span>` : "-"}</small></td>

      <td data-label="Thao Tác">

        <div class="action-buttons-cell">

          ${st === "PENDING" ? `<button class="btn-sm btn-accept" onclick="acceptOrder('${o.order_id}')" title="Duyệt & Đẩy"><i class="fa-solid fa-check"></i> Duyệt</button>` : ""}

          <button class="btn-sm btn-edit" onclick="adminEditTarget('${o.order_id}', '${link}', 'link')" title="Sửa link MXH"><i class="fa-solid fa-pen"></i> Sửa</button>

          <button class="btn-sm btn-push" onclick="pushOrder('${o.order_id}')" title="Đẩy lại"><i class="fa-solid fa-paper-plane"></i> Đẩy</button>

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="Hoàn thành"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="Xóa đơn"><i class="fa-solid fa-trash"></i> Xóa</button>

        </div>

      </td>

    `;

    tbody.appendChild(tr);

  });

}



async function acceptOrder(oid) {

  if (!confirm(`Xác nhận DUYỆT đơn hàng ${oid} và tự động đẩy qua đối tác xử lý?`)) return;

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

      showToast(data.msg || "Không thể duyệt đơn.", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

      showToast(`Đã đẩy đơn ${oid} thành công!`, "success");

      loadOrders();

    } else {

      showToast(data.msg || JSON.stringify(data.result), "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

      showToast(`Đã đánh dấu hoàn thành đơn ${oid}`, "success");

      loadOrders();

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  }

}



async function deleteOrder(oid) {

  if (!confirm(`Bạn có chắc chắn muốn XÓA VĨNH VIỄN đơn hàng #${oid}?\nĐơn này sẽ bị xóa khỏi toàn bộ hệ thống và KHÔNG BAO GIỜ hồi lại khi tải lại trang.`)) return;

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

      showToast(`Đã xóa vĩnh viễn đơn #${oid}!`, "success");

    } else {

      showToast("Lỗi xóa: " + (data.msg || "Không thể xóa đơn"), "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

  }

}



async function adminEditTarget(oid, currentVal, type) {

  const isCode = type === "code";

  const label = isCode ? "mã mời Liên Quân" : "link bài viết MXH";

  const newVal = prompt(`Sửa ${label} cho đơn #${oid}:`, currentVal || "");

  if (newVal === null) return;

  const trimmed = newVal.trim();

  if (!trimmed) {

    showToast(`Vui lòng nhập ${label} mới!`, "warning");

    return;

  }

  showToast("Đang cập nhật và kích hoạt lại...", "info");

  try {

    const res = await fetch("/api/order/update-target", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ order_id: oid, new_target: trimmed })

    });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg || "Cập nhật thành công!", "success");

      loadOrders();

    } else {

      showToast(data.msg || "Cập nhật thất bại!", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  }

}



// ==========================================

// 3. CHUNG SỨC CONFIG

// ==========================================

function initChungSucAdmin() {

  document.getElementById("btnSaveCsConfig").addEventListener("click", saveChungSucConfig);

  document.getElementById("btnTestAutoNhanh").addEventListener("click", testAutoNhanh);



  // Quick % adjustment buttons for Chung Suc packages

  document.querySelectorAll(".btn-cs-adjust").forEach(btn => {

    btn.addEventListener("click", async () => {

      const pct = parseFloat(btn.dataset.pct);

      const actionText = pct > 0 ? `tăng +${pct}%` : `giảm ${pct}%`;

      if (!confirm(`Bạn có chắc muốn ${actionText} giá của tất cả gói Chung Sức?`)) return;

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

          showToast(data.msg || "Lỗi cập nhật giá!", "error");

        }

      } catch (e) {

        showToast("Lỗi mạng: " + e.message, "error");

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

        <label>Giá (VNĐ):</label>

        <input type="number" class="admin-input cs-price-input" data-id="${key}" value="${pkg.price || 0}">

        <label>Lượt buff:</label>

        <input type="number" class="admin-input cs-turns-input" data-id="${key}" value="${pkg.turns || 0}">

      </div>

    `;

    container.appendChild(row);

  });

}



async function testAutoNhanh() {

  const btn = document.getElementById("btnTestAutoNhanh");

  btn.disabled = true;

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang kết nối...`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);



  try {

    const res = await fetch("/api/admin/autonhanh/balance", { signal: controller.signal });

    const data = await res.json();

    const bal = data.success ? data.balance : null;

    if (bal !== null && bal !== undefined) {

      showToast(`Kết nối AutoNhanh thành công! Số dư hiện tại: ${bal.toLocaleString("vi-VN")} Xu`, "success");

    } else {

      showToast("Không thể đăng nhập AutoNhanh. Vui lòng kiểm tra lại tài khoản và mật khẩu.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

  } finally {

    clearTimeout(timeoutId);
    btn.disabled = false;

    btn.innerHTML = `<i class="fa-solid fa-key"></i> Đăng Nhập & Kiểm Tra Số Dư Xu`;

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

      pkgs[id].price_formatted = pkgs[id].price.toLocaleString("vi-VN") + "đ";

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

      showToast("Lưu cấu hình Chung Sức thành công!", "success");

    } else {

      showToast(data.msg || "Lỗi lưu cấu hình", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

      btnSaveLkPrice.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

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

        showToast(data2.msg || "Đã lưu bảng giá Locket Gold thành công!", "success");

      } catch (e) {

        showToast("Lỗi khi lưu giá Locket: " + e.message, "error");

      } finally {

        btnSaveLkPrice.disabled = false;

        btnSaveLkPrice.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu Bảng Giá Locket Gold';

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

          showToast("Đã dán và tự động bóc tách token!", "success");

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

    if (b) b.innerHTML = `<span style="color:#34d399; font-weight:700;"><i class="fa-solid fa-check"></i> Đã bóc tách (${fetchToken.length} ký tự)</span>`;

  }

  if (appTrans) {

    document.getElementById("newTokenAppTrans").value = appTrans;

    const b = document.getElementById("badgeAppTransStatus");

    if (b) b.innerHTML = `<span style="color:#34d399; font-weight:700;"><i class="fa-solid fa-check"></i> Đã bóc tách (${appTrans.length} ký tự)</span>`;

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

    nameInput.value = `Token StoreKit 2 (${prodId || "1 Tháng"} - #${transId || "VIP"})`;

  }



  const statusBox = document.getElementById("smartParseStatus");

  if (statusBox) {

    if (fetchToken && appTrans) {

      statusBox.style.display = "block";

      statusBox.style.background = "rgba(16, 185, 129, 0.15)";

      statusBox.style.color = "#34d399";

      statusBox.style.border = "1px solid rgba(16, 185, 129, 0.35)";

      statusBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>Đã tự động bóc tách thành công 100%!</strong> Đã nhận diện đầy đủ Fetch Token (${fetchToken.length} ký tự) & App Transaction (${appTrans.length} ký tự).`;

    } else if (fetchToken || appTrans) {

      statusBox.style.display = "block";

      statusBox.style.background = "rgba(234, 179, 8, 0.15)";

      statusBox.style.color = "#fde047";

      statusBox.style.border = "1px solid rgba(234, 179, 8, 0.35)";

      statusBox.innerHTML = `<i class="fa-solid fa-circle-info"></i> Đã nhận diện được 1 Token. Vui lòng kiểm tra trường còn lại bên dưới.`;

    } else {

      statusBox.style.display = "block";

      statusBox.style.background = "rgba(239, 68, 68, 0.15)";

      statusBox.style.color = "#f87171";

      statusBox.style.border = "1px solid rgba(239, 68, 68, 0.35)";

      statusBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Không thể nhận diện Token. Hãy chắc chắn bạn đã dán đầy đủ Request có chứa fetch_token và app_transaction.`;

    }

  }

}



async function loadLocketTokens() {

  const tbody = document.getElementById("locketTokensTableBody");

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách token...</td></tr>`;



  try {

    const res = await fetch("/api/admin/locket/tokens");

    const data = await res.json();

    if (data.success && data.tokens) {

      renderLocketTokensTable(data.tokens);

    }

  } catch (e) {

    tbody.innerHTML = `<tr><td colspan="5" style="color: red;">Lỗi tải token: ${e.message}</td></tr>`;

  }

}



function renderLocketTokensTable(tokens) {

  const tbody = document.getElementById("locketTokensTableBody");

  tbody.innerHTML = "";



  if (tokens.length === 0) {

    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--admin-muted);">Chưa có bộ token StoreKit 2 nào trong hệ thống.</td></tr>`;

    return;

  }



  tokens.forEach(t => {

    const tr = document.createElement("tr");

    tr.innerHTML = `

      <td><strong>${t.name}</strong><br><small class="text-dim">ID: ${t.id}</small></td>

      <td><code>${t.product_id}</code></td>

      <td>${t.days_text || t.status_text}</td>

      <td>${t.active ? `<span class="admin-badge badge-green">Hoạt Động</span>` : `<span class="admin-badge badge-red">Tắt</span>`}</td>

      <td>

        <div class="action-buttons-cell">

          <button class="btn-sm btn-push" onclick="testLocketToken('${t.id}')" title="Test Token"><i class="fa-solid fa-vial"></i> Test</button>

          <button class="btn-sm btn-accept" onclick="toggleLocketToken('${t.id}')" title="Bật/Tắt"><i class="fa-solid fa-power-off"></i></button>

          <button class="btn-sm btn-delete" onclick="deleteLocketToken('${t.id}')" title="Xóa"><i class="fa-solid fa-trash"></i></button>

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

      showToast("Token hợp lệ và hoạt động tốt!", "success");

    } else {

      showToast("Token lỗi: " + (data.msg || JSON.stringify(data.result)), "error");

    }

  } catch (e) {

    showToast("Lỗi test token: " + e.message, "error");

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

      showToast("Đã thay đổi trạng thái token!", "success");

      loadLocketTokens();

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  }

}



async function deleteLocketToken(tid) {

  if (!confirm("Bạn có chắc chắn muốn XÓA bộ token này?")) return;

  try {

    const res = await fetch("/api/admin/locket/tokens/delete", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ id: tid })

    });

    const data = await res.json();

    if (data.success) {

      showToast("Đã xóa token!", "success");

      loadLocketTokens();

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

    showToast("Vui lòng dán nội dung Token hoặc Request vào ô bóc tách!", "error");

    return;

  }



  try {

    const res = await fetch("/api/admin/locket/tokens/add", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        name: name || "Token mới (StoreKit 2)",

        fetch_token: fetchToken,

        app_transaction: appTrans,

        transaction_id: transId,

        product_id: prodId,

        raw: rawText

      })

    });

    const data = await res.json();

    if (data.success) {

      showToast("Thêm và kích hoạt token thành công!", "success");

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

      showToast(data.msg || "Không thể thêm token", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

    showToast("Vui lòng nhập Username Locket!", "error");

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

      showToast(data.msg || "Lỗi kích hoạt Gold", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

      showToast("Lưu Advanced Tokens thành công!", "success");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

      btnCheckBal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {

        const res = await fetch("/api/admin/tangtim/balance", { signal: controller.signal });

        const data = await res.json();

        if (data.success) {

          showToast(`Số dư TangTim: ${data.balance_usd}$ (~${data.balance_formatted})`, "success");

          const el = document.getElementById("balTangTim");

          if (el) el.textContent = data.balance_formatted;

        } else {

          showToast(data.msg || "Không thể lấy số dư TangTim", "error");

        }

      } catch (e) {

        showToast("Lỗi mạng: " + e.message, "error");

      } finally {

        clearTimeout(timeoutId);
        btnCheckBal.disabled = false;

        btnCheckBal.innerHTML = '<i class="fa-solid fa-wallet text-gold"></i> Kiểm Tra Số Dư TangTim';

      }

    });

  }



  // Sync maintenance status button

  const btnSyncMaint = document.getElementById("btnSyncMaintenance");

  if (btnSyncMaint) {

    btnSyncMaint.addEventListener("click", async () => {

      btnSyncMaint.disabled = true;

      btnSyncMaint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...';

      try {

        const res = await fetch("/api/admin/tangtim/sync-maintenance", { method: "POST" });

        const data = await res.json();

        showToast(data.msg || "Đã quét trạng thái bảo trì!", data.success ? "success" : "error");

      } catch (e) {

        showToast("Lỗi mạng: " + e.message, "error");

      } finally {

        btnSyncMaint.disabled = false;

        btnSyncMaint.innerHTML = '<i class="fa-solid fa-shield-halved text-cyan"></i> Quét Bảo Trì Máy Chủ';

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

        showToast("Vui lòng nhập tỷ lệ % hợp lệ (>= 0)!", "error");

        return;

      }

      btnSaveMargin.disabled = true;

      btnSaveMargin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tính lại giá toàn bộ dịch vụ...`;

      try {

        const res = await fetch("/api/admin/margin", {

          method: "POST",

          headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ margin_percent: marginVal })

        });

        const data = await res.json();

        if (data.success) {

          showToast(data.msg || `Đã cập nhật tỷ lệ chênh lệch giá thành +${marginVal}%!`, "success");

          const badgeMargin = document.getElementById("badgeCurrentMargin");

          if (badgeMargin) badgeMargin.textContent = `Hiện tại: +${marginVal}%`;

          const topMarginBtn = document.getElementById("btnTopMargin");

          if (topMarginBtn) topMarginBtn.innerHTML = `<i class="fa-solid fa-percent"></i> <span>Chỉnh % Giá (+${marginVal}%)</span>`;

        } else {

          showToast(data.msg || "Lỗi khi lưu tỷ lệ %!", "error");

        }

      } catch (e) {

        showToast("Lỗi mạng: " + e.message, "error");

      } finally {

        btnSaveMargin.disabled = false;

        btnSaveMargin.innerHTML = `<i class="fa-solid fa-calculator"></i> Áp Dụng & Tính Lại Giá Bán Toàn Bộ Dịch Vụ`;

      }

    });

  }

}



async function syncMxhServices() {

  const btn = document.getElementById("btnSyncMxhServices");

  btn.disabled = true;

  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...`;



  try {

    const res = await fetch("/api/admin/mxh/sync-services", { method: "POST" });

    const data = await res.json();

    if (data.success) {

      showToast(data.msg, "success");

    } else {

      showToast(data.msg || "Lỗi đồng bộ dịch vụ.", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Đồng Bộ Danh Mục Từ TangTim`;

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

      showToast("Lưu cấu hình MXH & Flash Sale thành công!", "success");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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

        <i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Tuyệt vời! Hiện không có dòng tiền nào bị sai cú pháp hoặc chưa khớp lệnh.

      </td></tr>`;

      return;

    }



    tbody.innerHTML = data.transactions.map(item => {

      const isMatched = item.status === "MATCHED";

      return `

        <tr>

          <td><code class="font-mono" style="color: #60a5fa; font-weight: 700;">${item.trans_id}</code></td>

          <td><strong style="color: #34d399;">${item.amount_formatted || item.amount.toLocaleString('vi-VN') + 'đ'}</strong></td>

          <td style="max-width: 260px; font-size: 0.8rem; word-break: break-all;">${item.description || 'N/A'}</td>

          <td style="font-size: 0.8rem; color: var(--admin-muted);">${item.trans_time || ''}</td>

          <td>

            ${isMatched ? `<span class="badge badge-success" style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 4px 8px; border-radius: 4px;">Đã gán #${item.matched_order_id}</span>` : `

              <input type="text" id="assign_order_${item.trans_id}" placeholder="#CS... hoặc #LK..." class="admin-input" style="padding: 6px 10px; font-size: 0.82rem; width: 100%;">

            `}

          </td>

          <td style="text-align: center;">

            ${isMatched ? `<i class="fa-solid fa-check text-green" style="color: #10b981;"></i>` : `

              <button type="button" class="btn-admin-primary" onclick="assignUnmatchedTrans('${item.trans_id}')" style="padding: 6px 12px; font-size: 0.8rem; white-space: nowrap;">

                <i class="fa-solid fa-link"></i> Gán Đơn

              </button>

            `}

          </td>

        </tr>

      `;

    }).join("");

  } catch (e) {

    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Lỗi tải dữ liệu: ${e.message}</td></tr>`;

  }

}



async function assignUnmatchedTrans(transId) {

  const input = document.getElementById(`assign_order_${transId}`);

  if (!input) return;

  const orderId = input.value.trim().toUpperCase();

  if (!orderId) {

    showToast("Vui lòng nhập Mã đơn hàng cần gán (#CS..., #LK..., #TT...)", "error");

    return;

  }



  if (!confirm(`Xác nhận gán giao dịch ${transId} vào đơn hàng #${orderId} và kích hoạt trả hàng tự động?`)) {

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

      showToast(data.msg || "Gán đơn thất bại", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

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

      showToast("Lưu thông tin ngân hàng thành công!", "success");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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



  // Tự động lưu khi gạt bất kỳ công tắc nào

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

    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...`;

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

      showToast("✅ Đã lưu trạng thái hiển thị dịch vụ thành công!", "success");

    } else {

      showToast(data.msg || "Lỗi lưu cấu hình dịch vụ", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  } finally {

    if (btn && !isInstant) {

      btn.disabled = false;

      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Lưu Trạng Thái Dịch Vụ`;

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

    if (data.success) showToast("Lưu Telegram Bot thành công!", "success");

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  }

}



async function testTelegram() {

  try {

    const res = await fetch("/api/admin/config/telegram/test", { method: "POST" });

    const data = await res.json();

    if (data.success) {

      showToast("Đã gửi tin nhắn test đến Telegram!", "success");

    } else {

      showToast(data.msg || "Lỗi gửi test", "error");

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

  }

}



async function changeAdminPassword() {

  const pwd = document.getElementById("newAdminPassword").value.trim();

  if (!pwd) {

    showToast("Vui lòng nhập mật khẩu mới!", "error");

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

      showToast("Đã cập nhật mật khẩu Admin!", "success");

      document.getElementById("newAdminPassword").value = "";

    }

  } catch (e) {

    showToast("Lỗi: " + e.message, "error");

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



    // Chung Sức

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

    if (badgeMargin) badgeMargin.textContent = `Hiện tại: +${margin}%`;

    const topMarginBtn = document.getElementById("btnTopMargin");

    if (topMarginBtn) topMarginBtn.innerHTML = `<i class="fa-solid fa-percent"></i> <span>Chỉnh % Giá (+${margin}%)</span>`;



    const sale = cfg.sale_campaign || {};

    document.getElementById("saleEnabled").value = String(sale.enabled !== false);

    document.getElementById("salePercent").value = sale.discount_percent || 25;

    document.getElementById("saleDurationDays").value = sale.duration_days || 5;



    // Payment

    const pay = cfg.payment || {};

    document.getElementById("bankId").value = pay.bank_id || "970454";

    document.getElementById("bankName").value = pay.bank_name || "Ngân Hàng Bản Việt (BVBank - ZaloPay)";

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

    showToast("Vui lòng nhập Email và Mật khẩu Locket!", "error");

    return;

  }

  const btn = document.getElementById("btn_locket_login");

  btn.disabled = true;

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đăng nhập Locket...';



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

      showToast(data.msg || "Đăng nhập Locket thành công! Đã tự động cập nhật Bearer Token.", "success");

    } else {

      showToast(data.msg || "Đăng nhập thất bại!", "error");

    }

  } catch (err) {

    showToast("Lỗi kết nối: " + err.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Đăng Nhập Locket & Lấy Token';

  }

}



async function handleImportLocketRaw() {

  const raw = (document.getElementById("locket_raw_input") ? document.getElementById("locket_raw_input").value : "").trim();

  if (!raw) {

    showToast("Vui lòng dán gói tin HTTP Catcher hoặc Shadowrocket vào ô!", "error");

    return;

  }

  const btn = document.getElementById("btnImportLocketRaw");

  btn.disabled = true;

  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang bóc tách...';



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

      showToast(data.msg || "Đã bóc tách và lưu Authorization & AppCheck thành công!", "success");

      document.getElementById("locket_raw_input").value = "";

    } else {

      showToast(data.msg || "Bóc tách thất bại!", "error");

    }

  } catch (err) {

    showToast("Lỗi kết nối: " + err.message, "error");

  } finally {

    btn.disabled = false;

    btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Bóc Tách & Lưu Token Locket';

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

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--admin-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách dịch vụ...</td></tr>';



  try {

    const res = await fetch("/api/admin/mxh/services");

    const data = await res.json();

    if (data.success && data.services) {

      gAdminMxhServices = data.services;

      const countEl = document.getElementById("mxhTotalServicesCount");

      if (countEl) countEl.textContent = gAdminMxhServices.length;

      renderAdminMxhServicesTable();

    } else {

      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#ef4444;">Không thể tải danh sách dịch vụ.</td></tr>';

    }

  } catch (err) {

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#ef4444;">Lỗi kết nối: ${err.message}</td></tr>`;

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

    // 2. Origin (Việt vs Tây)

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

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--admin-muted);">Không tìm thấy dịch vụ nào khớp với bộ lọc!</td></tr>';

    return;

  }



  tbody.innerHTML = filtered.map(s => {

    const sid = s.service_id || s.id;

    const isActive = s.active !== false;

    const isViet = (s.origin === "viet");

    const origBadge = isViet 

      ? '<span class="admin-badge badge-red" style="font-weight:700;"><i class="fa-solid fa-flag"></i> 🇻🇳 Việt</span>'

      : '<span class="admin-badge badge-cyan" style="font-weight:700;"><i class="fa-solid fa-earth-americas"></i> 🌍 Tây</span>';



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

        <td><b style="color: #facc15;">${s.price_formatted || (s.price_per_unit + "đ")}</b></td>

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

      showToast(makeActive ? `Đã BẬT hiển thị gói #${serviceId}` : `Đã TẮT gói #${serviceId}`, "success");

    } else {

      showToast(data.msg || "Lỗi cập nhật", "error");

      renderAdminMxhServicesTable();

    }

  } catch (err) {

    showToast("Lỗi kết nối: " + err.message, "error");

    renderAdminMxhServicesTable();

  }

}



async function handleBatchToggleMxhServices(makeActive) {

  const filtered = getFilteredAdminMxhServices();

  if (filtered.length === 0) {

    showToast("Không có dịch vụ nào đang được lọc!", "warning");

    return;

  }

  const sids = filtered.map(s => String(s.service_id || s.id));

  const confirmMsg = `Bạn có chắc muốn ${makeActive ? "BẬT" : "TẮT"} ${sids.length} gói dịch vụ đang lọc?`;

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

      showToast(data.msg || "Đã cập nhật hàng loạt!", "success");

      renderAdminMxhServicesTable();

    } else {

      showToast(data.msg || "Lỗi cập nhật", "error");

    }

  } catch (err) {

    showToast("Lỗi kết nối: " + err.message, "error");

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

// CHỢ PREMIUM ADMIN LOGIC

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

      <button class="code-copy-btn" onclick="copyToClipboard('${o.target}', 'Đã copy tài khoản!')" title="Copy"><i class="fa-solid fa-copy"></i></button>

      ${o.note ? `<br><small class="text-dim">Note: ${o.note}</small>` : ''}

    ` : '<span class="text-dim">Không có</span>';



    const deliveryStatus = o.delivery_info ? `

      <span class="text-green" style="font-weight:700; cursor:pointer;" onclick="openDeliveryModal('${o.order_id}', '${o.platform_name || ''}', '${o.package_name || ''}', '${o.target || ''}', '${o.delivery_info.replace(/'/g, "\\'")}')" title="Bấm để xem/sửa thông tin bàn giao">

        <i class="fa-solid fa-circle-check"></i> Đã cấp

      </span>

    ` : `<span class="text-dim">Chưa cấp</span>`;



    tr.setAttribute("data-order-id", o.order_id);

    tr.innerHTML = `

      <td data-label="Mã Đơn"><strong>#${o.order_id}</strong></td>

      <td data-label="Nền Tảng">${platBadge}</td>

      <td data-label="Gói Mua"><strong>${o.package_name || "-"}</strong><br><small class="text-cyan">${o.duration || ""}</small></td>

      <td data-label="Tài Khoản">${targetDisplay}</td>

      <td data-label="Số Zalo"><code>${o.zalo || "N/A"}</code></td>

      <td data-label="Số Tiền"><strong class="text-gold">${o.amount_formatted || (Number(o.amount || 0).toLocaleString() + "đ")}</strong></td>

      <td data-label="Trạng Thái"><span class="admin-status-pill ${statusClass}">${st}</span></td>

      <td data-label="Thời Gian"><small>${o.created_time || o.created_at || "-"}</small></td>

      <td data-label="Bàn Giao">${deliveryStatus}</td>

      <td data-label="Thao Tác">

        <div class="action-buttons-cell">

          ${st === "PENDING" ? `<button class="btn-sm btn-accept" onclick="acceptOrder('${o.order_id}')" title="Duyệt đơn"><i class="fa-solid fa-check"></i> Duyệt</button>` : ""}

          <button class="btn-sm btn-push" onclick="openDeliveryModal('${o.order_id}', '${o.platform_name || ''}', '${o.package_name || ''}', '${o.target || ''}', '${(o.delivery_info || '').replace(/'/g, "\\'")}')" title="Bàn giao tài khoản"><i class="fa-solid fa-key"></i> Bàn Giao</button>

          <button class="btn-sm btn-complete" onclick="markComplete('${o.order_id}')" title="Hoàn thành"><i class="fa-solid fa-circle-check"></i> Xong</button>

          <button class="btn-sm btn-delete" onclick="deleteOrder('${o.order_id}')" title="Xóa đơn"><i class="fa-solid fa-trash"></i> Xóa</button>

        </div>

      </td>

    `;

    if (o.package_desc) {

      const packageCell = tr.querySelector('[data-label="Gói Mua"]');

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

  document.getElementById("delivModalPkg").textContent = pkgName || "Gói";

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

    textarea.value = `Đã gửi lời mời YouTube Premium vào Gmail: ${target}\nBạn mở ứng dụng Gmail trên điện thoại, bấm vào thư mời từ Google Family và nhấn \"Chấp nhận lời mời\" là YouTube Premium được kích hoạt thành công trọn gói!`;

  } else if (type === "sp") {

    textarea.value = `Đã gia hạn tài khoản Spotify Premium thành công cho: ${target}\nBạn mở app Spotify trên thiết bị của mình và thưởng thức âm thanh 320kbps không quảng cáo nhé!`;

  } else if (type === "nf") {

    textarea.value = `Tài khoản Netflix: ${target}\nMật khẩu: NetflixVip@2026\nProfile riêng: Khách Hàng\nMã PIN riêng: 2601\nChất lượng Ultra HD 4K, bảo hành 1 đổi 1 suốt thời gian sử dụng!`;

  }

}



async function submitDeliveryInfo() {

  if (!gCurrentDelivOid) return;

  const content = (document.getElementById("delivModalContent")?.value || "").trim();

  const btn = document.getElementById("btnSubmitDelivery");



  if (!content) {

    if (!confirm("Bạn chưa nhập nội dung bàn giao tài khoản. Bạn có chắc chắn muốn hoàn tất đơn không?")) return;

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

      showToast(data.msg || `Đã bàn giao đơn #${gCurrentDelivOid}!`, "success");

      closeDeliveryModal();

      loadOrders();

      loadStats();

    } else {

      showToast(data.msg || "Lỗi lưu thông tin", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

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

          statusBadge.textContent = "ĐANG BẬT";

          statusBadge.style.background = "rgba(16, 185, 129, 0.2)";

          statusBadge.style.color = "#34d399";

          statusBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";

        } else {

          statusBadge.textContent = "ĐANG TẮT";

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

      showToast(data.msg || (active ? "Đã BẬT dịch vụ!" : "Đã TẮT (Ẩn) dịch vụ khỏi trang web!"), "success");

      if (gAdminPremiumConfig && gAdminPremiumConfig[sid]) {

        gAdminPremiumConfig[sid].active = active;

      }

    } else {

      showToast(data.msg || "Không thể cập nhật trạng thái dịch vụ.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

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

      showToast(data.msg || (active ? "Đã bật gói!" : "Đã tắt gói!"), "success");

    } else {

      showToast(data.msg || "Không thể cập nhật trạng thái gói.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

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

      showToast(data.msg || (enabled ? "Đã BẬT Chợ Premium thành công!" : "Đã TẮT (Ẩn) Chợ Premium thành công!"), "success");

      if (statusBadge) {

        if (enabled) {

          statusBadge.textContent = "ĐANG BẬT";

          statusBadge.style.background = "rgba(16, 185, 129, 0.2)";

          statusBadge.style.color = "#34d399";

          statusBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";

        } else {

          statusBadge.textContent = "ĐANG TẮT (ẨN)";

          statusBadge.style.background = "rgba(239, 68, 68, 0.2)";

          statusBadge.style.color = "#f87171";

          statusBadge.style.borderColor = "rgba(239, 68, 68, 0.4)";

        }

      }

    } else {

      showToast(data.msg || "Không thể cập nhật trạng thái chợ.", "error");

      if (toggleInput) toggleInput.checked = !enabled;

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

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

        <p>Chưa có dịch vụ nào trong chợ. Hãy bấm <strong>"+ Thêm Dịch Vụ Mới"</strong> để bắt đầu!</p>

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

              <input type="text" class="admin-input svc-input-name" value="${svc.name || sid}" style="font-size: 1.1rem; font-weight: 800; color: #f8fafc; padding: 4px 8px; width: 220px;" placeholder="Tên dịch vụ...">

              <code style="background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px; color: ${color}; font-size: 0.82rem;">${sid}</code>

            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">

              <input type="text" class="admin-input svc-input-badge" value="${svc.badge || ''}" placeholder="Huy hiệu (vd: Chính Chủ Gmail)..." style="font-size: 0.8rem; width: 170px; padding: 2px 6px;">

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

          <span style="font-size: 0.82rem; color: #cbd5e1; font-weight: 700;">Kích hoạt</span>



          <button type="button" class="btn-sm btn-edit" onclick="openAddPackageModal('${sid}', '${svc.name}')" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-weight: 700; padding: 6px 12px; border-radius: 8px;">

            <i class="fa-solid fa-plus"></i> Thêm Gói

          </button>



          <button type="button" class="btn-sm btn-delete" onclick="deletePremiumService('${sid}')" style="padding: 6px 12px; border-radius: 8px;">

            <i class="fa-solid fa-trash"></i> Xóa Dịch Vụ

          </button>

        </div>

      </div>



      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">

        <div>

          <label style="font-size: 0.78rem; color: #94a3b8; display: block; margin-bottom: 2px;">Khẩu hiệu (Tagline):</label>

          <input type="text" class="admin-input svc-input-tagline" value="${svc.tagline || ''}" placeholder="Khẩu hiệu hiển thị trên web..." style="width: 100%; font-size: 0.84rem;">

        </div>

        <div>

          <label style="font-size: 0.78rem; color: #94a3b8; display: block; margin-bottom: 2px;">Nhãn ô nhập của khách:</label>

          <input type="text" class="admin-input svc-input-label" value="${svc.input_label || 'Tài khoản / Email'}" placeholder="Nhãn input..." style="width: 100%; font-size: 0.84rem;">

        </div>

      </div>



      <div class="admin-table-responsive" style="margin-top: 10px;">

        <table class="admin-table" style="font-size: 0.86rem;">

          <thead>

            <tr>

              <th>Mã Gói</th>

              <th>Tên Gói</th>

              <th>Thời Hạn</th>

              <th>Ghi Chú Riêng</th>

              <th>Huy Hiệu</th>

              <th>Giá Bán (VNĐ)</th>

              <th style="text-align: center;">Kích Hoạt</th>

              <th style="text-align: center;">Thao Tác</th>

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

    return `<tr><td colspan="8" style="text-align: center; color: var(--admin-muted); padding: 16px;">Chưa có gói nào cho dịch vụ này. Hãy bấm "+ Thêm Gói" ở trên!</td></tr>`;

  }



  return pkgKeys.map(k => {

    const pkg = pkgs[k];

    return `

      <tr data-pkg-id="${k}">

        <td><code>${k}</code></td>

        <td><input type="text" class="admin-input pkg-input-name" value="${pkg.name || ''}" style="width: 100%; min-width: 150px;"></td>

        <td><input type="text" class="admin-input pkg-input-duration" value="${pkg.duration || ''}" style="width: 100px;"></td>

        <td><textarea class="admin-input pkg-input-desc" maxlength="500" rows="2" placeholder="Ghi chú hiển thị cho khách..." style="width: 180px; resize: vertical;">${escapePackageText(pkg.desc)}</textarea></td>

        <td><input type="text" class="admin-input pkg-input-badge" value="${pkg.badge || ''}" style="width: 110px;"></td>

        <td><input type="number" class="admin-input pkg-input-price" value="${pkg.price || 0}" step="1000" style="width: 120px;"></td>

        <td style="text-align: center;">

          <label class="switch-toggle" style="display: inline-block;">

            <input type="checkbox" class="pkg-input-active" ${pkg.active !== false ? 'checked' : ''} onchange="togglePackageActive('${sid}', '${k}', this.checked)">

            <span class="slider round"></span>

          </label>

        </td>

        <td style="text-align: center;">

          <button type="button" class="btn-sm btn-delete" onclick="deletePremiumPackage('${sid}', '${k}')" title="Xóa gói này">

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

      const inputLabel = block.querySelector(".svc-input-label")?.value.trim() || "Email / Tài khoản nhận";



      const pkgs = {};

      const rows = block.querySelectorAll(".svc-packages-tbody tr[data-pkg-id]");



      rows.forEach(tr => {

        const pkgId = tr.dataset.pkgId;

        const pName = tr.querySelector(".pkg-input-name")?.value.trim() || "";

        const pDuration = tr.querySelector(".pkg-input-duration")?.value.trim() || "1 Tháng";

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

          price_formatted: pPrice.toLocaleString("vi-VN") + "đ",

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

      showToast("🎉 Đã lưu toàn bộ cấu hình Chợ Premium thành công!", "success");

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "Không thể lưu cấu hình.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối máy chủ: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



// Modal Thêm Dịch Vụ Mới

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

    showToast("Vui lòng nhập Mã ID và Tên dịch vụ!", "error");

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

      showToast(`🎉 Đã thêm dịch vụ "${name}" thành công!`, "success");

      closeAddServiceModal();

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "Không thể thêm dịch vụ.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



async function deletePremiumService(sid) {

  if (!confirm(`Bạn có chắc chắn muốn xóa toàn bộ dịch vụ "${sid}" và các gói đi kèm không?`)) {

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

      showToast(`Đã xóa dịch vụ "${sid}".`, "success");

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "Không thể xóa dịch vụ.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

  }

}



// Modal Thêm Gói Mới

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

  if (durEl) durEl.value = "1 Tháng";

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

    showToast("Vui lòng điền đủ Mã gói, Tên gói và Giá hợp lệ (>0)!", "error");

    return;

  }

  if (!/^[a-z0-9_-]{1,64}$/.test(pkgId)) {

    showToast("Mã gói chỉ gồm chữ thường, số, dấu '-' hoặc '_' (tối đa 64 ký tự).", "error");

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

      showToast(`Đã thêm gói "${name}"!`, "success");

      closeAddPackageModal();

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "Không thể thêm gói.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

  } finally {

    if (btn) btn.disabled = false;

  }

}



async function deletePremiumPackage(sid, pkgId) {

  if (!confirm(`Bạn có chắc chắn muốn xóa gói "${pkgId}" khỏi dịch vụ "${sid}"?`)) {

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

      showToast(`Đã xóa gói "${pkgId}".`, "success");

      loadPremiumAdmin();

    } else {

      showToast(data.msg || "Không thể xóa gói.", "error");

    }

  } catch (e) {

    showToast("Lỗi kết nối: " + e.message, "error");

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
