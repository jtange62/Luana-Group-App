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
})(typeof window !== "undefined" ? window : globalThis);
