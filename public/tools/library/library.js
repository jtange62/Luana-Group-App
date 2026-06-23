(function () {
  "use strict";

  // Bounce to hub login if not authenticated.
  if (!LuanaAuth.requireLogin()) return;

  var state = { lessons: [], query: "", editingId: null };
  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };

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

  var URL_RE = /(https?:\/\/[^\s<]+)/g;
  function linkify(text) {
    return esc(text).replace(URL_RE, function (u) {
      var clean = u.replace(/[.,)]+$/, "");
      return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + "</a>";
    });
  }

  function tagList(tags) {
    return String(tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
  }

  // Open a file: fetch with the auth header, then open the blob in a new tab.
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

  function matches(l, q) {
    if (!q) return true;
    var hay = [l.title, l.notes, l.tags].concat(
      (l.files || []).map(function (f) { return f.filename; })
    ).join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function render() {
    var list = $("list");
    list.innerHTML = "";
    var q = state.query.trim().toLowerCase();
    var items = state.lessons.filter(function (l) { return matches(l, q); });

    $("empty").hidden = state.lessons.length > 0;
    $("noMatch").hidden = !(state.lessons.length > 0 && items.length === 0);

    items.forEach(function (l) { list.appendChild(card(l)); });
  }

  function card(l) {
    var el = document.createElement("article");
    el.className = "lesson-card";

    var tags = tagList(l.tags);
    var tagsHtml = tags.map(function (t) { return '<span class="tag-pill">' + esc(t) + "</span>"; }).join("");

    var linkHtml = "";
    if (l.link_url) {
      var domain = "";
      try { domain = new URL(l.link_url).hostname.replace(/^www\./, ""); } catch (e) {}
      linkHtml = '<a class="lesson-link" href="' + esc(l.link_url) + '" target="_blank" rel="noopener noreferrer">🔗 ' + esc(domain || l.link_url) + "</a>";
    }

    var filesHtml = (l.files || []).map(function (f) {
      var label = esc(f.filename) + (f.size ? ' <span class="file-size">' + fileSize(f.size) + "</span>" : "");
      return '<button class="file-chip" data-fid="' + esc(f.id) + '">📄 ' + label + "</button>";
    }).join("");

    el.innerHTML =
      '<div class="lesson-head">' +
        '<h2 class="lesson-title">' + esc(l.title) + "</h2>" +
        (l.author === me ? '<div class="lesson-actions"><button class="edit-btn" title="Edit">✎</button><button class="del-btn" title="Delete">✕</button></div>' : "") +
      "</div>" +
      '<p class="lesson-meta">' + esc(l.author) + " · " + timeAgo(Number(l.created_at)) + "</p>" +
      (l.notes ? '<p class="lesson-notes">' + linkify(l.notes) + "</p>" : "") +
      (linkHtml ? '<div class="lesson-linkrow">' + linkHtml + "</div>" : "") +
      (filesHtml ? '<div class="lesson-files">' + filesHtml + "</div>" : "") +
      (tagsHtml ? '<div class="lesson-tags">' + tagsHtml + "</div>" : "");

    el.querySelectorAll(".file-chip").forEach(function (btn) {
      btn.onclick = function () { openFile(btn.getAttribute("data-fid")); };
    });

    var editBtn = el.querySelector(".edit-btn");
    if (editBtn) editBtn.onclick = function () { startEdit(l); };
    var delBtn = el.querySelector(".del-btn");
    if (delBtn) delBtn.onclick = function () { removeLesson(l); };

    return el;
  }

  function removeLesson(l) {
    if (!confirm('Delete "' + l.title + '" and its files?')) return;
    LuanaAuth.api("lesson", { method: "DELETE", body: JSON.stringify({ id: l.id, author: me }) })
      .then(function () { return loadLessons(); });
  }

  // ---------- Add / edit form ----------
  var chosenFiles = null;

  function openForm() { $("form").hidden = false; $("fTitle").focus(); }
  function resetForm() {
    state.editingId = null;
    $("formTitle").textContent = "New lesson";
    $("fTitle").value = ""; $("fNotes").value = ""; $("fLink").value = ""; $("fTags").value = "";
    $("fFiles").value = ""; chosenFiles = null; $("fileList").textContent = "";
    $("formMsg").textContent = "";
    $("fileRow").hidden = false; $("editFilesHint").hidden = true;
    $("saveBtn").disabled = false;
  }
  function closeForm() { $("form").hidden = true; resetForm(); }

  function startEdit(l) {
    resetForm();
    state.editingId = l.id;
    $("formTitle").textContent = "Edit lesson";
    $("fTitle").value = l.title || "";
    $("fNotes").value = l.notes || "";
    $("fLink").value = l.link_url || "";
    $("fTags").value = l.tags || "";
    $("fileRow").hidden = true;
    $("editFilesHint").hidden = (l.files || []).length === 0;
    $("form").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("fTitle").focus();
  }

  function save() {
    var title = $("fTitle").value.trim();
    var msg = $("formMsg");
    msg.textContent = "";
    if (!title) { msg.textContent = "A title is required."; return; }
    $("saveBtn").disabled = true;

    if (state.editingId) {
      LuanaAuth.api("lesson", { method: "PATCH", body: JSON.stringify({
        id: state.editingId, author: me, title: title,
        notes: $("fNotes").value.trim(), link: $("fLink").value.trim(), tags: $("fTags").value.trim()
      }) }).then(function () { closeForm(); return loadLessons(); })
        .catch(function () { msg.textContent = "Couldn't save. Try again."; $("saveBtn").disabled = false; });
      return;
    }

    var fd = new FormData();
    fd.append("title", title);
    fd.append("author", me);
    fd.append("notes", $("fNotes").value.trim());
    fd.append("link", $("fLink").value.trim());
    fd.append("tags", $("fTags").value.trim());
    if (chosenFiles) {
      for (var i = 0; i < chosenFiles.length; i++) fd.append("files", chosenFiles[i]);
    }

    var t = LuanaAuth.token();
    msg.textContent = "Uploading…";
    fetch("/api/lesson", {
      method: "POST",
      headers: t ? { Authorization: "Bearer " + t } : {},
      body: fd
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { msg.textContent = res.j.error || "Upload failed."; $("saveBtn").disabled = false; return; }
        closeForm();
        return loadLessons();
      })
      .catch(function () { msg.textContent = "Couldn't reach the server."; $("saveBtn").disabled = false; });
  }

  function loadLessons() {
    $("loading").style.display = "block";
    return LuanaAuth.api("lessons").then(function (res) {
      $("loading").style.display = "none";
      state.lessons = res.lessons || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }

  // ---------- Wire up ----------
  $("addBtn").onclick = function () {
    if (!$("form").hidden && !state.editingId) { closeForm(); return; }
    resetForm(); openForm();
  };
  $("cancelBtn").onclick = closeForm;
  $("saveBtn").onclick = save;
  $("fFiles").onchange = function (e) {
    chosenFiles = e.target.files;
    var names = [];
    for (var i = 0; i < chosenFiles.length; i++) names.push(chosenFiles[i].name);
    $("fileList").textContent = names.length ? names.join(", ") : "";
  };
  $("search").oninput = function (e) { state.query = e.target.value; render(); };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  loadLessons();
})();
