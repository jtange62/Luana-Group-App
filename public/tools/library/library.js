(function () {
  "use strict";

  // Bounce to hub login if not authenticated.
  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var state = { lessons: [], query: "", program: "all", month: "all", editingId: null };
  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };

  // When opened from the calendar (?lesson=<id>), highlight that theme.
  var highlightId = (function () {
    var m = /[?&]lesson=([^&]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  })();

  function monthName(m) { var n = parseInt(m, 10); return n >= 1 && n <= 12 ? MONTHS[n - 1] : ""; }
  function monthShort(m) { var name = monthName(m); return name ? name.slice(0, 3) : ""; }

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

  function isImage(f) { return (f.type || "").indexOf("image/") === 0; }

  // Fetch a saved image (auth-gated) and show it as a thumbnail; tap to open lightbox.
  function loadThumb(btn, fileId) {
    var t = LuanaAuth.token();
    fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        btn.style.backgroundImage = "url('" + url + "')";
        btn.classList.add("loaded");
        btn._src = url;
        btn.onclick = function () {
          var grid = btn.closest(".photo-grid");
          var all = grid ? Array.prototype.slice.call(grid.querySelectorAll(".photo")) : [btn];
          openLightbox(all, btn);
        };
      })
      .catch(function () { btn.textContent = "🖼️"; });
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
    var items = state.lessons.filter(function (l) {
      if (state.program !== "all" && l.program !== state.program) return false;
      if (state.month !== "all" && String(l.month || "") !== state.month) return false;
      return matches(l, q);
    });

    $("empty").hidden = state.lessons.length > 0;
    $("noMatch").hidden = !(state.lessons.length > 0 && items.length === 0);

    items.forEach(function (l) { list.appendChild(card(l)); });

    if (highlightId) {
      var target = list.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(highlightId) : highlightId) + '"]');
      if (target) {
        target.classList.add("is-highlight");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(function () { target.classList.remove("is-highlight"); }, 2600);
      }
      highlightId = null; // only once
    }
  }

  function card(l) {
    var el = document.createElement("article");
    el.className = "lesson-card";
    el.setAttribute("data-id", l.id);

    var tags = tagList(l.tags);
    var tagsHtml = tags.map(function (t) { return '<span class="tag-pill">' + esc(t) + "</span>"; }).join("");

    var linkHtml = "";
    if (l.link_url) {
      var domain = "";
      try { domain = new URL(l.link_url).hostname.replace(/^www\./, ""); } catch (e) {}
      linkHtml = '<a class="lesson-link" href="' + esc(l.link_url) + '" target="_blank" rel="noopener noreferrer">🔗 ' + esc(domain || l.link_url) + "</a>";
    }

    var pics = (l.files || []).filter(isImage);
    var docs = (l.files || []).filter(function (f) { return !isImage(f); });
    var picsHtml = pics.length
      ? '<div class="photo-grid">' + pics.map(function (f) {
          return '<button class="photo" data-fid="' + esc(f.id) + '" aria-label="' + esc(f.filename) + '"></button>';
        }).join("") + "</div>"
      : "";
    var filesHtml = docs.map(function (f) {
      var label = esc(f.filename) + (f.size ? ' <span class="file-size">' + fileSize(f.size) + "</span>" : "");
      return '<button class="file-chip" data-fid="' + esc(f.id) + '">📄 ' + label + "</button>";
    }).join("");

    var badgeBits = [];
    if (l.program) badgeBits.push(esc(l.program));
    if (l.month) badgeBits.push(monthShort(l.month));
    var badgeHtml = badgeBits.length ? '<span class="lesson-badge">' + badgeBits.join(" · ") + "</span>" : "";

    el.innerHTML =
      '<div class="lesson-head">' +
        '<h2 class="lesson-title">' + esc(l.title) + "</h2>" +
        (l.author === me ? '<div class="lesson-actions"><button class="edit-btn" title="Edit">✎</button><button class="del-btn" title="Delete">✕</button></div>' : "") +
      "</div>" +
      (badgeHtml ? '<div class="lesson-badgerow">' + badgeHtml + "</div>" : "") +
      '<p class="lesson-meta">' + esc(l.author) + " · " + timeAgo(Number(l.created_at)) + "</p>" +
      (l.notes ? '<p class="lesson-notes">' + linkify(l.notes) + "</p>" : "") +
      (linkHtml ? '<div class="lesson-linkrow">' + linkHtml + "</div>" : "") +
      picsHtml +
      (filesHtml ? '<div class="lesson-files">' + filesHtml + "</div>" : "") +
      (tagsHtml ? '<div class="lesson-tags">' + tagsHtml + "</div>" : "");

    el.querySelectorAll(".photo").forEach(function (btn) { loadThumb(btn, btn.getAttribute("data-fid")); });
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
  var chosen = []; // { file, url } for new files being staged
  var editingFiles = []; // existing files on the lesson being edited
  var pendingDeletes = []; // file ids to delete on save

  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      chosen.push({ file: f, url: isImage(f) ? URL.createObjectURL(f) : null });
    });
    renderChosen();
  }
  function clearChosen() {
    chosen.forEach(function (c) { if (c.url) URL.revokeObjectURL(c.url); });
    chosen = [];
    editingFiles = [];
    pendingDeletes = [];
    renderChosen();
  }
  function renderChosen() {
    var wrap = $("fileList"); wrap.innerHTML = "";
    var t = LuanaAuth.token();

    // Existing files on the lesson (shown in edit mode)
    editingFiles.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "thumb";
      if (isImage(f)) {
        item.style.backgroundSize = "cover";
        item.style.backgroundPosition = "center";
        fetch("/api/file/" + f.id, { headers: t ? { Authorization: "Bearer " + t } : {} })
          .then(function (r) { return r.blob(); })
          .then(function (blob) { item.style.backgroundImage = "url('" + URL.createObjectURL(blob) + "')"; })
          .catch(function () { item.textContent = "🖼️"; });
      } else {
        item.classList.add("thumb-file");
        item.innerHTML = '<span class="thumb-doc">📄</span><span class="thumb-name">' + esc(f.filename) + "</span>";
      }
      var x = document.createElement("button");
      x.type = "button"; x.className = "thumb-x"; x.textContent = "✕";
      x.onclick = (function (fileId) {
        return function () {
          pendingDeletes.push(fileId);
          editingFiles = editingFiles.filter(function (ff) { return ff.id !== fileId; });
          renderChosen();
        };
      })(f.id);
      item.appendChild(x);
      wrap.appendChild(item);
    });

    // New files being staged
    chosen.forEach(function (c, idx) {
      var item = document.createElement("div");
      if (c.url) {
        item.className = "thumb";
        item.innerHTML = '<img src="' + c.url + '" alt="">';
      } else {
        item.className = "thumb thumb-file";
        item.innerHTML = '<span class="thumb-doc">📄</span><span class="thumb-name">' + esc(c.file.name) + "</span>";
      }
      var x = document.createElement("button");
      x.type = "button"; x.className = "thumb-x"; x.textContent = "✕";
      x.onclick = function () { if (c.url) URL.revokeObjectURL(c.url); chosen.splice(idx, 1); renderChosen(); };
      item.appendChild(x);
      wrap.appendChild(item);
    });
  }

  function openForm() { $("form").hidden = false; $("fTitle").focus(); }
  function resetForm() {
    state.editingId = null;
    $("formTitle").textContent = "New lesson";
    $("fTitle").value = ""; $("fNotes").value = ""; $("fLink").value = ""; $("fTags").value = "";
    $("fProgram").value = ""; $("fMonth").value = "";
    $("fFiles").value = ""; clearChosen();
    $("formMsg").textContent = "";
    $("saveBtn").disabled = false;
  }
  function closeForm() { $("form").hidden = true; resetForm(); }

  function startEdit(l) {
    resetForm();
    state.editingId = l.id;
    $("formTitle").textContent = "Edit lesson";
    $("fTitle").value = l.title || "";
    $("fProgram").value = l.program || "";
    $("fMonth").value = l.month || "";
    $("fNotes").value = l.notes || "";
    $("fLink").value = l.link_url || "";
    $("fTags").value = l.tags || "";
    editingFiles = (l.files || []).slice();
    renderChosen();
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
      var editId = state.editingId;
      var editToken = LuanaAuth.token();
      msg.textContent = "Saving…";
      LuanaAuth.api("lesson", { method: "PATCH", body: JSON.stringify({
        id: editId, author: me, title: title,
        program: $("fProgram").value, month: $("fMonth").value,
        notes: $("fNotes").value.trim(), link: $("fLink").value.trim(), tags: $("fTags").value.trim()
      }) })
      .then(function () {
        if (!pendingDeletes.length) return;
        return Promise.all(pendingDeletes.map(function (fileId) {
          return LuanaAuth.api("lesson-file", { method: "DELETE",
            body: JSON.stringify({ id: fileId, lessonId: editId, author: me }) });
        }));
      })
      .then(function () {
        if (!chosen.length) return;
        var fd = new FormData();
        fd.append("lessonId", editId);
        fd.append("author", me);
        chosen.forEach(function (c) { fd.append("files", c.file); });
        msg.textContent = "Uploading files…";
        return fetch("/api/lesson-file", {
          method: "POST",
          headers: editToken ? { Authorization: "Bearer " + editToken } : {},
          body: fd
        }).then(function (r) { return r.json().then(function (j) {
          if (!r.ok) throw new Error(j.error || "upload failed");
        }); });
      })
      .then(function () { closeForm(); return loadLessons(); })
      .catch(function (e) {
        msg.textContent = (e && e.message) || "Couldn't save. Try again.";
        $("saveBtn").disabled = false;
      });
      return;
    }

    var fd = new FormData();
    fd.append("title", title);
    fd.append("author", me);
    fd.append("program", $("fProgram").value);
    fd.append("month", $("fMonth").value);
    fd.append("notes", $("fNotes").value.trim());
    fd.append("link", $("fLink").value.trim());
    fd.append("tags", $("fTags").value.trim());
    chosen.forEach(function (c) { fd.append("files", c.file); });

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

  // ---------- Build filters & form controls ----------
  function renderProgramTabs() {
    var nav = $("programTabs"); nav.innerHTML = "";
    ["all"].concat(PROGRAMS).forEach(function (p) {
      var b = document.createElement("button");
      var active = state.program === p;
      b.className = "tab" + (active ? " active" : "");
      b.textContent = p === "all" ? "All" : p;
      b.onclick = function () { state.program = p; renderProgramTabs(); render(); };
      nav.appendChild(b);
    });
  }

  function fillMonthFilter() {
    var sel = $("monthFilter");
    sel.innerHTML = '<option value="all">All months</option>';
    MONTHS.forEach(function (name, i) {
      sel.innerHTML += '<option value="' + (i + 1) + '">' + name + "</option>";
    });
  }

  function fillFormSelects() {
    var ps = $("fProgram");
    ps.innerHTML = '<option value="">Program…</option>';
    PROGRAMS.forEach(function (p) { ps.innerHTML += '<option value="' + p + '">' + p + "</option>"; });
    var ms = $("fMonth");
    ms.innerHTML = '<option value="">All-year / no month</option>';
    MONTHS.forEach(function (name, i) { ms.innerHTML += '<option value="' + (i + 1) + '">' + name + "</option>"; });
  }

  // ---------- Wire up ----------
  $("addBtn").onclick = function () {
    if (!$("form").hidden && !state.editingId) { closeForm(); return; }
    resetForm(); openForm();
  };
  $("cancelBtn").onclick = closeForm;
  $("saveBtn").onclick = save;
  $("fFiles").onchange = function (e) {
    addFiles(e.target.files);
    e.target.value = ""; // allow adding more in a second pick
  };
  $("search").oninput = function (e) { state.query = e.target.value; render(); };
  $("monthFilter").onchange = function (e) { state.month = e.target.value; render(); };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  // ---------- Lightbox ----------
  var lbUrls = [], lbIdx = 0, lbTx = 0, lbTy = 0, lbDir = null;
  function showLbFrame() {
    $("lbImg").src = lbUrls[lbIdx];
    var multi = lbUrls.length > 1;
    $("lbPrev").hidden = !multi;
    $("lbNext").hidden = !multi;
    $("lbCounter").textContent = multi ? (lbIdx + 1) + " / " + lbUrls.length : "";
  }
  function openLightbox(btns, tapped) {
    var loaded = btns.filter(function (b) { return !!b._src; });
    if (!loaded.length) return;
    lbUrls = loaded.map(function (b) { return b._src; });
    lbIdx = loaded.indexOf(tapped); if (lbIdx < 0) lbIdx = 0;
    showLbFrame();
    $("lightbox").hidden = false;
  }
  $("lbClose").onclick = function () { $("lightbox").hidden = true; };
  $("lightbox").onclick = function (e) { if (e.target === $("lightbox")) $("lightbox").hidden = true; };
  $("lbPrev").onclick = function () { lbIdx = (lbIdx - 1 + lbUrls.length) % lbUrls.length; showLbFrame(); };
  $("lbNext").onclick = function () { lbIdx = (lbIdx + 1) % lbUrls.length; showLbFrame(); };
  $("lightbox").addEventListener("touchstart", function (e) {
    lbTx = e.touches[0].clientX; lbTy = e.touches[0].clientY; lbDir = null;
  }, { passive: true });
  $("lightbox").addEventListener("touchmove", function (e) {
    var dx = Math.abs(e.touches[0].clientX - lbTx), dy = Math.abs(e.touches[0].clientY - lbTy);
    if (!lbDir && (dx > 6 || dy > 6)) lbDir = dx >= dy ? "h" : "v";
    if (lbDir === "h") e.preventDefault();
  }, { passive: false });
  $("lightbox").addEventListener("touchend", function (e) {
    if (lbDir !== "h" || lbUrls.length < 2) return;
    var dx = e.changedTouches[0].clientX - lbTx;
    if (Math.abs(dx) > 40) { lbIdx = (lbIdx + (dx < 0 ? 1 : -1) + lbUrls.length) % lbUrls.length; showLbFrame(); }
  });

  renderProgramTabs();
  fillMonthFilter();
  fillFormSelects();
  loadLessons();
})();
