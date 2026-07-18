(function () {
  "use strict";

  // Bounce to hub login if not authenticated.
  if (!LuanaAuth.requireLogin()) return;

  var CATS = [
    { id: "curriculum", label: "curriculum", color: "#0F6E56", soft: "#E1F5EE", dark: "#085041" },
    { id: "events",     label: "events",     color: "#993C1D", soft: "#FAECE7", dark: "#712B13" },
    { id: "supplies",   label: "supplies",   color: "#854F0B", soft: "#FAEEDA", dark: "#633806" },
    { id: "general",    label: "general",    color: "#5F5E5A", soft: "#F1EFE8", dark: "#444441" }
  ];

  var state = { activeCat: "all", posts: [], nextCursor: null, hasMore: false };
  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var esc = LuanaUtils.esc, timeAgo = LuanaUtils.timeAgo, fileSize = LuanaUtils.fileSize;
  var isImage = LuanaUtils.isImage, firstUrl = LuanaUtils.firstUrl, linkify = LuanaUtils.linkify;

  function cat(id) { return CATS.filter(function (c) { return c.id === id; })[0] || CATS[3]; }

  function openFile(fileId) {
    var t = LuanaAuth.token();
    fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      })
      .catch(function () { alert("Couldn't open that file. Try again."); });
  }

  // Blob URLs by file id, so the 30s feed refresh reuses already-downloaded
  // images instead of re-fetching every photo on each poll.
  var thumbCache = {};
  function pruneThumbCache(posts) {
    var live = {};
    posts.forEach(function (post) {
      (post.files || []).forEach(function (file) { if (isImage(file)) live[file.id] = true; });
    });
    Object.keys(thumbCache).forEach(function (fileId) {
      if (!live[fileId]) { URL.revokeObjectURL(thumbCache[fileId]); delete thumbCache[fileId]; }
    });
  }
  function applyThumb(btn, url) {
    btn.style.backgroundImage = "url('" + url + "')";
    btn.classList.add("loaded");
    btn._src = url;
    btn.onclick = function () {
      var grid = btn.closest(".photo-grid");
      var all = grid ? Array.prototype.slice.call(grid.querySelectorAll(".photo")) : [btn];
      openLightbox(all, btn);
    };
  }
  function loadThumb(btn, fileId) {
    if (thumbCache[fileId]) { applyThumb(btn, thumbCache[fileId]); return; }
    var t = LuanaAuth.token();
    fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        thumbCache[fileId] = url;
        applyThumb(btn, url);
      })
      .catch(function () { btn.textContent = "🖼️"; });
  }

  // ---------- Composer file staging ----------
  var chosen = [];
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
    var wrap = $("ideaFileList"); wrap.innerHTML = "";
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

  function syncComposer() {
    $("catSelect").hidden = state.activeCat !== "all";
  }

  function renderTabs() {
    var nav = $("tabs"); nav.innerHTML = "";
    var allActive = state.activeCat === "all";
    var allBtn = document.createElement("button");
    allBtn.className = "tab" + (allActive ? " active" : "");
    if (allActive) { allBtn.style.borderColor = "var(--teal-mid)"; allBtn.style.background = "var(--teal-soft)"; allBtn.style.color = "#085041"; }
    allBtn.textContent = "All";
    allBtn.onclick = function () { state.activeCat = "all"; syncComposer(); renderTabs(); renderFeed(); };
    nav.appendChild(allBtn);
    CATS.forEach(function (c) {
      var active = c.id === state.activeCat;
      var b = document.createElement("button");
      b.className = "tab" + (active ? " active" : "");
      b.style.borderColor = active ? c.color : "";
      b.style.background = active ? c.soft : "";
      b.style.color = active ? c.dark : "";
      b.innerHTML = '<span class="dot" style="background:' + c.color + '"></span>' + c.label;
      b.onclick = function () { state.activeCat = c.id; syncComposer(); renderTabs(); renderFeed(); };
      nav.appendChild(b);
    });
  }

  function renderFeed() {
    var feed = $("feed");
    var items = state.posts
      .filter(function (p) { return state.activeCat === "all" || p.category === state.activeCat; })
      .sort(function (a, b) { return b.created_at - a.created_at; });
    feed.innerHTML = "";
    $("empty").hidden = items.length > 0;
    items.forEach(function (p) { feed.appendChild(card(p)); });
  }

  function card(p) {
    var c = cat(p.category);
    var el = document.createElement("article");
    el.className = "card";
    var preview = "";
    if (p.link_url) {
      preview =
        '<a class="link-card" href="' + esc(p.link_url) + '" target="_blank" rel="noopener noreferrer">' +
          (p.link_image ? '<div class="link-thumb" style="background-image:url(\'' + esc(p.link_image) + '\')"></div>' : "") +
          '<div class="link-body"><p class="link-title">' + esc(p.link_title || p.link_url) + "</p>" +
            (p.link_desc ? '<p class="link-desc">' + esc(p.link_desc) + "</p>" : "") +
            '<p class="link-domain">' + esc(p.link_domain || "") + "</p></div></a>";
    }
    var pics = (p.files || []).filter(isImage);
    var docs = (p.files || []).filter(function (f) { return !isImage(f); });
    var picsHtml = pics.length
      ? '<div class="photo-grid">' + pics.map(function (f) {
          return '<button class="photo" data-fid="' + esc(f.id) + '" aria-label="' + esc(f.filename) + '"></button>';
        }).join("") + "</div>"
      : "";
    var filesHtml = docs.map(function (f) {
      var label = esc(f.filename) + (f.size ? ' <span class="file-size">' + fileSize(f.size) + "</span>" : "");
      return '<button class="file-chip" data-fid="' + esc(f.id) + '">📄 ' + label + "</button>";
    }).join("");

    el.innerHTML =
      '<div class="card-head"><div class="who">' +
        '<div class="avatar" style="background:' + c.soft + ";color:" + c.dark + '">' + esc((p.author || "?").charAt(0).toUpperCase()) + "</div>" +
        "<div><p class=\"who-name\">" + esc(p.author) + '</p><p class="who-time">' + timeAgo(p.created_at) + "</p></div></div>" +
        '<div class="card-head-right">' +
          '<span class="cat-pill" style="background:' + c.soft + ";color:" + c.dark + '">' + c.label + "</span>" +
          '<button class="edit-btn" title="Edit post">✎</button>' +
          (p.author === me ? '<button class="del-btn" title="Delete post" aria-label="Delete this idea">✕</button>' : "") +
        "</div>" +
      "</div>" +
      '<p class="card-text">' + linkify(p.text) + "</p>" +
      '<div class="edit-box"><textarea class="edit-ta"></textarea><div class="edit-actions"><button class="edit-save">Save</button><button class="edit-cancel">Cancel</button></div></div>' +
      preview +
      picsHtml +
      (filesHtml ? '<div class="idea-files">' + filesHtml + "</div>" : "") +
      '<div class="comments"></div>';

    el.querySelectorAll(".photo").forEach(function (btn) { loadThumb(btn, btn.getAttribute("data-fid")); });
    el.querySelectorAll(".file-chip[data-fid]").forEach(function (btn) {
      btn.onclick = function () { openFile(btn.getAttribute("data-fid")); };
    });

    var editBtn = el.querySelector(".edit-btn");
    var editBox = el.querySelector(".edit-box");
    var cardText = el.querySelector(".card-text");
    if (editBtn) {
      editBtn.onclick = function () {
        var ta = editBox.querySelector(".edit-ta");
        ta.value = p.text;
        editBox.classList.add("open");
        cardText.style.display = "none";
        ta.focus();
      };
      editBox.querySelector(".edit-cancel").onclick = function () {
        editBox.classList.remove("open");
        cardText.style.display = "";
      };
      editBox.querySelector(".edit-save").onclick = function () {
        var ta = editBox.querySelector(".edit-ta");
        var txt = ta.value.trim();
        if (!txt) return;
        ta.disabled = true;
        LuanaAuth.api("post", { method: "PATCH", body: JSON.stringify({ id: p.id, author: me, text: txt }) })
          .then(function () { return loadPosts(true); })
          .catch(function () { ta.disabled = false; });
      };
    }

    var delBtn = el.querySelector(".del-btn");
    if (delBtn) {
      delBtn.onclick = function () {
        var preview = p.text.length > 50 ? p.text.slice(0, 50) + "…" : p.text;
        if (!confirm('Permanently delete your idea "' + preview + '"? This cannot be undone.')) return;
        LuanaAuth.api("post", { method: "DELETE", body: JSON.stringify({ id: p.id, author: me }) })
          .then(function () { LuanaUtils.reportSuccess("Idea deleted."); return loadPosts(true); })
          .catch(function (e) { LuanaUtils.reportError(e, "Couldn't delete the idea. Nothing was changed."); });
      };
    }

    var cwrap = el.querySelector(".comments");
    (p.comments || []).forEach(function (cm) {
      var d = document.createElement("div");
      d.className = "comment";
      d.innerHTML = "<b>" + esc(cm.author) + "</b> <span>" + linkify(cm.text) + "</span>";
      cwrap.appendChild(d);
    });
    var toggle = document.createElement("button");
    toggle.className = "reply-toggle";
    var n = (p.comments || []).length;
    toggle.innerHTML = "💬 " + (n ? n + " replies — add one" : "reply");
    var box = document.createElement("div");
    box.className = "reply-box";
    box.innerHTML = '<input type="text" placeholder="your reply…" /><button>Send</button>';
    toggle.onclick = function () { box.classList.toggle("open"); if (box.classList.contains("open")) box.querySelector("input").focus(); };
    box.querySelector("button").onclick = function () {
      var input = box.querySelector("input");
      var txt = input.value.trim();
      if (!txt) return;
      input.disabled = true;
      LuanaAuth.api("comment", { method: "POST", body: JSON.stringify({ post_id: p.id, author: me, text: txt }) })
        .then(function () { return loadPosts(true); })
        .catch(function () { input.disabled = false; });
    };
    cwrap.appendChild(toggle);
    cwrap.appendChild(box);
    return el;
  }

  function normalizePosts(posts) {
    return posts.map(function (p) {
      p.created_at = Number(p.created_at);
      p.comments = p.comments || [];
      return p;
    });
  }

  function mergePosts(incoming) {
    var byId = {};
    state.posts.concat(incoming).forEach(function (post) { byId[post.id] = post; });
    state.posts = Object.keys(byId).map(function (id) { return byId[id]; })
      .sort(function (a, b) { return b.created_at - a.created_at || String(b.id).localeCompare(String(a.id)); });
  }

  function loadPosts(reset) {
    $("loading").style.display = "block";
    return LuanaAuth.api("posts?limit=30").then(function (res) {
      $("loading").style.display = "none";
      var incoming = normalizePosts(res.posts || []);
      if (reset) state.posts = incoming; else mergePosts(incoming);
      if (reset) {
        state.nextCursor = res.next_cursor || null;
        state.hasMore = !!res.has_more;
      }
      pruneThumbCache(state.posts);
      renderFeed();
      $("loadMore").hidden = !state.hasMore;
    }).catch(function (e) { $("loading").style.display = "none"; LuanaUtils.reportError(e, "Couldn't load ideas."); });
  }

  function loadOlder() {
    if (!state.hasMore || !state.nextCursor) return;
    $("loadMore").disabled = true;
    return LuanaAuth.api("posts?limit=30&before=" + encodeURIComponent(state.nextCursor)).then(function (res) {
      mergePosts(normalizePosts(res.posts || []));
      state.nextCursor = res.next_cursor || null;
      state.hasMore = !!res.has_more;
      renderFeed();
      $("loadMore").hidden = !state.hasMore;
      $("loadMore").disabled = false;
    }).catch(function (e) { $("loadMore").disabled = false; LuanaUtils.reportError(e, "Couldn't load older ideas."); });
  }

  function post() {
    var text = $("ideaInput").value.trim();
    if (!text) return;
    var category = state.activeCat === "all" ? $("catSelect").value : state.activeCat;
    $("postBtn").disabled = true;
    var fd = new FormData();
    fd.append("text", text);
    fd.append("author", me);
    fd.append("category", category);
    var link = firstUrl(text);
    if (link) fd.append("link", link);
    chosen.forEach(function (c) { fd.append("files", c.file); });
    var t = LuanaAuth.token();
    fetch("/api/post", {
      method: "POST",
      headers: t ? { Authorization: "Bearer " + t } : {},
      body: fd
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { $("postBtn").disabled = false; return; }
        $("ideaInput").value = "";
        clearChosen();
        $("postBtn").disabled = false;
        LuanaUtils.reportSuccess("Idea posted.");
        return loadPosts(true);
      })
      .catch(function () { $("postBtn").disabled = false; });
  }

  $("postingAs").textContent = "Posting as " + me;
  $("postBtn").onclick = post;
  $("loadMore").onclick = loadOlder;
  $("ideaFiles").onchange = function (e) { addFiles(e.target.files); e.target.value = ""; };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };
  setInterval(function () {
    if (!LuanaAuth.isLoggedIn() || document.hidden) return;
    // Don't re-render (and wipe) a reply or idea someone is mid-typing,
    // or staged file attachments that haven't been posted yet.
    var ae = document.activeElement;
    var typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") && ae.value;
    if (typing || chosen.length) return;
    loadPosts(false);
  }, 30000);

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

  renderTabs();
  syncComposer();
  loadPosts(true);
})();
