// Shared module control: enabled=false bypasses every rewrite in this script.
(function () {
    var diagnosticsEnabled = false;
    if (typeof $argument !== "undefined") {
        var control = typeof $argument === "string" ? /^enabled=(true|false)(?:&diagnostics=(true|false))?$/i.exec($argument.trim()) : null;
        if (!control || control[1].toLowerCase() === "false") {
            if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[Locket v12] bypass: " + (control ? "enabled=false" : "invalid module argument"));
            }
            $done({});
            return;
        }
        diagnosticsEnabled = !!control[2] && control[2].toLowerCase() === "true";
    }
// Author: Nguyen Tien Thuong
function notifyDiagnostic(outcome, message) {
    if (!diagnosticsEnabled) return;
    try {
        if (typeof $notification === "undefined" || typeof $notification.post !== "function") return;
        var key = "locket.rc.diagnostics.request." + outcome;
        var now = Date.now();
        var store = typeof $persistentStore !== "undefined" ? $persistentStore : null;
        if (store && typeof store.read === "function") {
            var last = Number(store.read(key));
            if (last > 0 && now >= last && now - last < 60000) return;
        }
        $notification.post("Locket RC - chẩn đoán", "Request: " + outcome, message);
        if (store && typeof store.write === "function") store.write(String(now), key);
    } catch (e) {
        // Diagnostic API/storage failures must not block the rewrite.
    }
}
var target = /^https:\/\/firebaseremoteconfig\.googleapis\.com\/v1\/projects\/locket-4252a\/namespaces\/firebase:fetch(?:\?|$)/;
function rewriteConfigRequest() {
    if (!target.test($request.url || "")) return {};
    if ($request.method !== "POST") {
        notifyDiagnostic("skipped", "Đã gọi script đúng endpoint nhưng request không phải POST; giữ nguyên request.");
        return {};
    }
    // Conditional fetch headers are independent of body decoding. Firebase's
    // Apple SDK sends gzip: an opaque/missing body must not prevent removing ETag.
    // Returning only headers preserves the original bytes and encoding headers.
    var headers = Object.assign({}, $request.headers || {});
    var removedETag = false;
    Object.keys(headers).forEach(function (key) {
        if (key.toLowerCase() === "if-none-match") {
            delete headers[key];
            removedETag = true;
        }
    });
    var decoded;
    try {
        decoded = typeof $request.body === "string" ? JSON.parse($request.body) : $request.body;
    } catch (e) {
        // Header refresh remains possible without reading or changing the body.
    }
    // Typed arrays/ArrayBuffers are opaque bytes, not decoded JSON objects.
    if (decoded && Object.prototype.toString.call(decoded) === "[object Object]") {
        var body = Object.assign({}, decoded);
        body.country_code = "us";
        body.time_zone = "America/New_York";
        // This cannot bypass the SDK's local minimum fetch interval.
        if (typeof console !== "undefined" && typeof console.log === "function") {
            console.log("[Locket RC v12] request rewritten: full config requested");
        }
        notifyDiagnostic("rewritten", "Đã bắt được lượt tải Remote Config và yêu cầu cấu hình đầy đủ. Chưa xác nhận phản hồi hoặc giao diện Locket.");
        return { body: JSON.stringify(body), headers: headers };
    }
    if (removedETag) {
        if (typeof console !== "undefined" && typeof console.log === "function") {
            console.log("[Locket RC v12] request headers rewritten: conditional ETag removed; original body preserved");
        }
        notifyDiagnostic("headers-refreshed", "Đã bỏ If-None-Match để yêu cầu cấu hình đầy đủ; giữ nguyên body chưa đọc được và các header khác. Chưa xác nhận phản hồi.");
        return { headers: headers };
    }
    notifyDiagnostic("skipped", "Không có body JSON hợp lệ hoặc ETag cần bỏ; giữ nguyên request.");
    return {};
}
$done(rewriteConfigRequest());

})();
