// Shared module control: enabled=false bypasses every rewrite in this script.
(function () {
    if (typeof $argument !== "undefined") {
        var control = typeof $argument === "string" ? /^enabled=(true|false)$/i.exec($argument.trim()) : null;
        if (!control || control[1].toLowerCase() === "false") {
            if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[Locket v12] bypass: " + (control ? "enabled=false" : "invalid module argument"));
            }
            $done({});
            return;
        }
    }
// Author: Nguyen Tien Thuong
const mapping = {
  '%E8%BD%A6%E7%A5%A8%E7%A5%A8': ['vip+watch_vip'],
  'Locket': ['Gold']
};

function rewriteRevenueCatResponse() {
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  const headers = $request.headers || {};
  const uaKey = Object.keys(headers).find(key => key.toLowerCase() === 'user-agent');
  const ua = uaKey ? headers[uaKey] : undefined;
  if (typeof ua !== 'string' || !ua) return {};

  let obj;
  try {
    obj = JSON.parse($response.body);
  } catch (e) {
    return {};
  }
  if (!isObject(obj) || !isObject(obj.subscriber) ||
      !isObject(obj.subscriber.subscriptions) || !isObject(obj.subscriber.entitlements)) {
    return {};
  }

  obj.Attention = 'Congratulations! Please do not sell or share it with others!';
  const locket02 = {
    is_sandbox: false,
    ownership_type: 'PURCHASED',
    billing_issues_detected_at: null,
    period_type: 'normal',
    expires_date: '9999-12-18T01:04:17Z',
    grace_period_expires_date: null,
    unsubscribe_detected_at: null,
    original_purchase_date: '3636-06-03T01:04:18Z',
    purchase_date: '3636-06-03T01:04:17Z',
    store: 'app_store',
  };
  const locket01 = {
    grace_period_expires_date: null,
    purchase_date: '3636-06-03T01:04:17Z',
    product_identifier: 'com.locket02.premium.yearly',
    expires_date: '9999-12-18T01:04:17Z',
  };
  const match = Object.keys(mapping).find(key => ua.includes(key));
  if (match) {
    const [entitlement, product] = mapping[match];
    if (product) {
      locket01.product_identifier = product;
      obj.subscriber.subscriptions[product] = locket02;
    } else {
      obj.subscriber.subscriptions['com.locket02.premium.yearly'] = locket02;
    }
    obj.subscriber.entitlements[entitlement] = locket01;
  } else {
    obj.subscriber.subscriptions['com.locket02.premium.yearly'] = locket02;
    obj.subscriber.entitlements.pro = locket01;
  }
  return { body: JSON.stringify(obj) };
}

$done(rewriteRevenueCatResponse());

})();
