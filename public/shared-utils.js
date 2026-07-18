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

  global.LuanaUtils = {
    esc: esc, timeAgo: timeAgo, fileSize: fileSize, isImage: isImage,
    firstUrl: firstUrl, linkify: linkify, reportError: reportError
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
      if (!modal.hidden) modalOpeners.set(modal, lastOutsideFocus);
      else {
        var opener = modalOpeners.get(modal);
        if (opener && opener.isConnected) opener.focus();
        modalOpeners.delete(modal);
      }
    });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
})(typeof window !== "undefined" ? window : globalThis);
