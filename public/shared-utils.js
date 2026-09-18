(function (global) {
  "use strict";

  var URL_RE = /(https?:\/\/[^\s<]+)/g;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function timeAgo(timestamp) {
    var minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.round(hours / 24);
    if (days < 7) return days + "d ago";
    return new Date(timestamp).toLocaleDateString();
  }

  function fileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function isImage(file) { return (file.type || "").indexOf("image/") === 0; }

  function firstUrl(text) {
    var match = String(text || "").match(URL_RE);
    return match ? match[0].replace(/[.,)]+$/, "") : null;
  }

  function linkify(text) {
    return esc(text).replace(URL_RE, function (url) {
      var clean = url.replace(/[.,)]+$/, "");
      return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + "</a>";
    });
  }

  function reportError(error, fallback) {
    var message = error && error.message && error.message !== "unauthorized"
      ? error.message : (fallback || "Something went wrong. Please try again.");
    if (global.console && console.error) console.error(error || message);
    if (!global.document || message === "unauthorized") return;
    var old = document.querySelector(".app-toast");
    if (old) old.remove();
    var toast = document.createElement("div");
    toast.className = "app-toast";
    toast.setAttribute("role", "alert");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 5000);
  }

  function reportSuccess(message) {
    if (!global.document) return;
    var old = document.querySelector(".app-toast");
    if (old) old.remove();
    var toast = document.createElement("div");
    toast.className = "app-toast app-toast-success";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3500);
  }

  // Count that a tool was opened. Fire and forget: a failed ping must never
  // interrupt the page, and nothing here identifies who opened it.
  function ping(tool) {
    if (!global.LuanaAuth || !LuanaAuth.isLoggedIn()) return;
    try {
      LuanaAuth.api("usage", { method: "POST", body: JSON.stringify({ tool: tool }) })
        .catch(function () {});
    } catch (e) {}
  }

  global.LuanaUtils = {
    esc: esc, timeAgo: timeAgo, fileSize: fileSize, isImage: isImage,
    firstUrl: firstUrl, linkify: linkify, reportError: reportError,
    reportSuccess: reportSuccess, ping: ping
  };

  if (!global.document) return;
  document.querySelectorAll("a.back-btn").forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      var internalReferrer = false;
      try { internalReferrer = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
      if (internalReferrer && history.length > 1) history.back();
      else location.href = "/";
    });
  });

  // One navigation and form-label treatment across every staff page.
  var navigation = document.createElement("nav");
  navigation.className = "app-nav";
  navigation.setAttribute("aria-label", "Staff tools");
  var path = location.pathname;
  var links = [["/", "Staff room"], ["/tools/today/", "Today"], ["/?view=resources", "Resources"], ["/tools/curriculum/", "Plans"], ["/tools/", "More"]];
  links.forEach(function (entry) {
    var link = document.createElement("a");
    link.href = entry[0]; link.textContent = entry[1];
    var active = (path + (path === "/" ? location.search : "")) === entry[0] || (entry[1] === "More" && ["/tools/students/", "/tools/calendar/", "/tools/website/"].indexOf(path) !== -1);
    if (active) link.setAttribute("aria-current", "page");
    navigation.appendChild(link);
  });
  var navHost = document.getElementById("board") || document.getElementById("app");
  if (navHost) navHost.appendChild(navigation);
  document.body.dataset.page = path.split("/").filter(Boolean).pop() || "ideas";
  document.querySelectorAll("label.field-label:not([for])").forEach(function (label) {
    var control = label.nextElementSibling;
    if (control && control.id && /^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName)) label.htmlFor = control.id;
  });

  var focusable = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
  var lastOutsideFocus = document.activeElement;
  var modalOpeners = new WeakMap();

  function visibleModal() {
    var modals = Array.prototype.slice.call(document.querySelectorAll(".modal:not([hidden])"));
    return modals.length ? modals[modals.length - 1] : null;
  }

  function prepareModal(modal) {
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("tabindex", "-1");
    var heading = modal.querySelector(".form-heading");
    if (heading && heading.id) modal.setAttribute("aria-labelledby", heading.id);
  }

  document.querySelectorAll(".modal").forEach(prepareModal);
  document.addEventListener("focusin", function (event) {
    var modal = visibleModal();
    if (!modal || !modal.contains(event.target)) lastOutsideFocus = event.target;
  });
  document.addEventListener("keydown", function (event) {
    var modal = visibleModal();
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      modal.click();
      return;
    }
    if (event.key !== "Tab") return;
    var items = Array.prototype.slice.call(modal.querySelectorAll(focusable)).filter(function (item) {
      return !item.hidden && item.getAttribute("aria-hidden") !== "true" && item.offsetParent !== null;
    });
    if (!items.length) { event.preventDefault(); modal.focus(); return; }
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      var modal = mutation.target;
      if (!modal.classList.contains("modal")) return;
      prepareModal(modal);
      if (!modal.hidden) {
        modalOpeners.set(modal, lastOutsideFocus);
        var firstControl = Array.from(modal.querySelectorAll(focusable)).find(function (item) { return item.offsetParent !== null; });
        (firstControl || modal).focus();
      }
      else {
        var opener = modalOpeners.get(modal);
        if (opener && opener.isConnected) opener.focus();
        modalOpeners.delete(modal);
      }
    });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
})(typeof window !== "undefined" ? window : globalThis);
