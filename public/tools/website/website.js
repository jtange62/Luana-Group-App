(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;

  var TYPES = ["Photo", "Newsletter", "Document", "Request", "Suggestion", "Other"];
  var FILTERS = [{ id: "new", label: "New" }, { id: "done", label: "Done" }, { id: "all", label: "All" }];

  var state = { submissions: [], filter: "new" };
  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var chosen = []; // { file, url } for the compose preview cluster
  var esc = LuanaUtils.esc, isImage = LuanaUtils.isImage;
  var timeAgo = LuanaUtils.timeAgo, fileSize = LuanaUtils.fileSize;

  function releaseThumbs(root) {
    if (!root) return;
    root.querySelectorAll(".photo").forEach(function (btn) {
      if (btn._src) { URL.revokeObjectURL(btn._src); btn._src = null; }
    });
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
    var list = $("list");
    releaseThumbs(list);
    list.innerHTML = "";
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

    var pics = (s.files || []).filter(function (f) { return (f.type || "").indexOf("image/") === 0; });
    var docs = (s.files || []).filter(function (f) { return (f.type || "").indexOf("image/") !== 0; });

    var picsHtml = pics.length
      ? '<div class="photo-grid">' + pics.map(function (f) {
          return '<button class="photo" data-fid="' + esc(f.id) + '" aria-label="' + esc(f.filename) + '"></button>';
        }).join("") + "</div>"
      : "";
    var docsHtml = docs.map(function (f) {
      var label = esc(f.filename) + (f.size ? ' <span class="file-size">' + fileSize(f.size) + "</span>" : "");
      return '<button class="file-chip" data-fid="' + esc(f.id) + '">📄 ' + label + "</button>";
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
      picsHtml +
      (docsHtml ? '<div class="wi-files">' + docsHtml + "</div>" : "") +
      '<p class="wi-meta">' + esc(s.author) + " · " + timeAgo(Number(s.created_at)) + "</p>";

    el.querySelectorAll(".photo").forEach(function (btn) { loadThumb(btn, btn.getAttribute("data-fid")); });
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

  // ---------- Compose preview cluster ----------
  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      chosen.push({ file: f, url: isImage(f) ? URL.createObjectURL(f) : null });
    });
    renderChosen();
  }
  function clearChosen() {
    chosen.forEach(function (c) { if (c.url) URL.revokeObjectURL(c.url); });
    chosen = [];
    renderChosen();
  }
  function renderChosen() {
    var wrap = $("fileList"); wrap.innerHTML = "";
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

  // Fetch a sent image (auth-gated) and show it as a thumbnail; tap to open lightbox.
  function loadThumb(btn, fileId) {
    var t = LuanaAuth.token();
    fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); })
      .then(function (blob) {
        if (!btn.isConnected) return;
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

  // ---------- Add form ----------
  function resetForm() {
    $("fType").value = "Photo"; $("fTitle").value = ""; $("fNotes").value = "";
    $("fFiles").value = ""; clearChosen();
    $("formMsg").textContent = ""; $("saveBtn").disabled = false;
  }
  function closeForm() { $("form").hidden = true; resetForm(); }

  function save() {
    var title = $("fTitle").value.trim();
    var notes = $("fNotes").value.trim();
    var msg = $("formMsg");
    msg.textContent = "";
    if (!title && !notes && chosen.length === 0) {
      msg.textContent = "Add a note or attach a file."; return;
    }
    var fd = new FormData();
    fd.append("author", me);
    fd.append("type", $("fType").value);
    fd.append("title", title);
    fd.append("notes", notes);
    chosen.forEach(function (c) { fd.append("files", c.file); });

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
    addFiles(e.target.files);
    e.target.value = ""; // allow adding more in a second pick
  };
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

  load();
})();
