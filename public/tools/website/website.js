(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;

  var TYPES = ["Photo", "Newsletter", "Document", "Request", "Suggestion", "Other"];
  var FILTERS = [{ id: "new", label: "New" }, { id: "done", label: "Done" }, { id: "all", label: "All" }];

  var state = { submissions: [], filter: "new" };
  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var chosenFiles = null;

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function timeAgo(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.round(h / 24);
    if (d < 7) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function fileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function openFile(fileId) {
    var t = LuanaAuth.token();
    fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("download failed"); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      })
      .catch(function () { alert("Couldn't open that file. Try again."); });
  }

  // ---------- Render ----------
  function renderTabs() {
    var nav = $("filterTabs"); nav.innerHTML = "";
    FILTERS.forEach(function (f) {
      var b = document.createElement("button");
      b.className = "seg-btn" + (state.filter === f.id ? " active" : "");
      var n = f.id === "all" ? state.submissions.length
        : state.submissions.filter(function (s) { return s.status === f.id; }).length;
      b.textContent = f.label + (n ? " " + n : "");
      b.onclick = function () { state.filter = f.id; render(); };
      nav.appendChild(b);
    });
  }

  function render() {
    renderTabs();
    var list = $("list"); list.innerHTML = "";
    var items = state.submissions.filter(function (s) {
      return state.filter === "all" ? true : s.status === state.filter;
    });
    $("empty").hidden = state.submissions.length > 0;
    $("noMatch").hidden = !(state.submissions.length > 0 && items.length === 0);
    items.forEach(function (s) { list.appendChild(card(s)); });
  }

  function card(s) {
    var el = document.createElement("article");
    el.className = "wi-card" + (s.status === "done" ? " is-done" : "");

    var filesHtml = (s.files || []).map(function (f) {
      var isImg = (f.type || "").indexOf("image/") === 0;
      var label = esc(f.filename) + (f.size ? ' <span class="file-size">' + fileSize(f.size) + "</span>" : "");
      return '<button class="file-chip" data-fid="' + esc(f.id) + '">' + (isImg ? "🖼️ " : "📄 ") + label + "</button>";
    }).join("");

    el.innerHTML =
      '<div class="wi-head">' +
        '<span class="type-pill">' + esc(s.type || "Other") + "</span>" +
        '<span class="status-pill status-' + (s.status === "done" ? "done" : "new") + '">' + (s.status === "done" ? "Done" : "New") + "</span>" +
        '<span class="wi-actions">' +
          '<button class="done-btn">' + (s.status === "done" ? "Reopen" : "✓ Done") + "</button>" +
          '<button class="del-btn" title="Delete">✕</button>' +
        "</span>" +
      "</div>" +
      (s.title ? '<p class="wi-title">' + esc(s.title) + "</p>" : "") +
      (s.notes ? '<p class="wi-notes">' + esc(s.notes) + "</p>" : "") +
      (filesHtml ? '<div class="wi-files">' + filesHtml + "</div>" : "") +
      '<p class="wi-meta">' + esc(s.author) + " · " + timeAgo(Number(s.created_at)) + "</p>";

    el.querySelectorAll(".file-chip").forEach(function (btn) {
      btn.onclick = function () { openFile(btn.getAttribute("data-fid")); };
    });
    el.querySelector(".done-btn").onclick = function () { toggleDone(s); };
    el.querySelector(".del-btn").onclick = function () { removeSub(s); };
    return el;
  }

  function toggleDone(s) {
    var next = s.status === "done" ? "new" : "done";
    LuanaAuth.api("submission", { method: "PATCH", body: JSON.stringify({ id: s.id, status: next }) })
      .then(function () { return load(); });
  }

  function removeSub(s) {
    if (!confirm("Delete this submission and its files?")) return;
    LuanaAuth.api("submission", { method: "DELETE", body: JSON.stringify({ id: s.id }) })
      .then(function () { return load(); });
  }

  // ---------- Add form ----------
  function resetForm() {
    $("fType").value = "Photo"; $("fTitle").value = ""; $("fNotes").value = "";
    $("fFiles").value = ""; chosenFiles = null; $("fileList").textContent = "";
    $("formMsg").textContent = ""; $("saveBtn").disabled = false;
  }
  function closeForm() { $("form").hidden = true; resetForm(); }

  function save() {
    var title = $("fTitle").value.trim();
    var notes = $("fNotes").value.trim();
    var msg = $("formMsg");
    msg.textContent = "";
    if (!title && !notes && !(chosenFiles && chosenFiles.length)) {
      msg.textContent = "Add a note or attach a file."; return;
    }
    var fd = new FormData();
    fd.append("author", me);
    fd.append("type", $("fType").value);
    fd.append("title", title);
    fd.append("notes", notes);
    if (chosenFiles) { for (var i = 0; i < chosenFiles.length; i++) fd.append("files", chosenFiles[i]); }

    var t = LuanaAuth.token();
    $("saveBtn").disabled = true;
    msg.textContent = "Sending…";
    fetch("/api/submission", { method: "POST", headers: t ? { Authorization: "Bearer " + t } : {}, body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { msg.textContent = res.j.error || "Upload failed."; $("saveBtn").disabled = false; return; }
        closeForm();
        state.filter = "new";
        return load();
      })
      .catch(function () { msg.textContent = "Couldn't reach the server."; $("saveBtn").disabled = false; });
  }

  function load() {
    $("loading").style.display = "block";
    return LuanaAuth.api("submissions").then(function (res) {
      $("loading").style.display = "none";
      state.submissions = res.submissions || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }

  // ---------- Wire up ----------
  $("fType").innerHTML = TYPES.map(function (t) { return '<option value="' + t + '">' + t + "</option>"; }).join("");
  $("addBtn").onclick = function () {
    if (!$("form").hidden) { closeForm(); return; }
    resetForm(); $("form").hidden = false; $("fTitle").focus();
  };
  $("cancelBtn").onclick = closeForm;
  $("saveBtn").onclick = save;
  $("fFiles").onchange = function (e) {
    chosenFiles = e.target.files;
    var names = [];
    for (var i = 0; i < chosenFiles.length; i++) names.push(chosenFiles[i].name);
    $("fileList").textContent = names.length ? names.join(", ") : "";
  };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  load();
})();
