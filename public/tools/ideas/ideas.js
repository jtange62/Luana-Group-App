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

  var state = { activeCat: "all", posts: [] };
  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };

  function cat(id) { return CATS.filter(function (c) { return c.id === id; })[0] || CATS[3]; }
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

  var URL_RE = /(https?:\/\/[^\s<]+)/g;
  function firstUrl(text) { var m = text.match(URL_RE); return m ? m[0].replace(/[.,)]+$/, "") : null; }
  function linkify(text) {
    return esc(text).replace(URL_RE, function (u) {
      var clean = u.replace(/[.,)]+$/, "");
      return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + "</a>";
    });
  }

  function isImage(f) { return (f.type || "").indexOf("image/") === 0; }

  function fileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

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
    if (allActive) { allBtn.style.borderColor = "var(--teal-mid)"; allBtn.style.background = "var(--teal-soft)"; allBtn.style.color = "var(--teal)"; }
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
          (p.author === me ? '<button class="edit-btn" title="Edit post">✎</button><button class="del-btn" title="Delete post">✕</button>' : "") +
        "</div>" +
      "</div>" +
      '<p class="card-text">' + linkify(p.text) + "</p>" +
      (p.author === me ? '<div class="edit-box"><textarea class="edit-ta"></textarea><div class="edit-actions"><button class="edit-save">Save</button><button class="edit-cancel">Cancel</button></div></div>' : "") +
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
          .then(function () { return loadPosts(); })
          .catch(function () { ta.disabled = false; });
      };
    }

    var delBtn = el.querySelector(".del-btn");
    if (delBtn) {
      delBtn.onclick = function () {
        if (!confirm("Delete this post?")) return;
        LuanaAuth.api("post", { method: "DELETE", body: JSON.stringify({ id: p.id, author: me }) })
          .then(function () { return loadPosts(); });
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
        .then(function () { return loadPosts(); })
        .catch(function () { input.disabled = false; });
    };
    cwrap.appendChild(toggle);
    cwrap.appendChild(box);
    return el;
  }

  function loadPosts() {
    $("loading").style.display = "block";
    return LuanaAuth.api("posts").then(function (res) {
      $("loading").style.display = "none";
      state.posts = (res.posts || []).map(function (p) {
        p.created_at = Number(p.created_at);
        p.comments = p.comments || [];
        return p;
      });
      renderFeed();
    }).catch(function () { $("loading").style.display = "none"; });
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
        return loadPosts();
      })
      .catch(function () { $("postBtn").disabled = false; });
  }

  $("postingAs").textContent = "Posting as " + me;
  $("postBtn").onclick = post;
  $("ideaFiles").onchange = function (e) { addFiles(e.target.files); e.target.value = ""; };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };
  setInterval(function () { if (LuanaAuth.isLoggedIn() && !document.hidden) loadPosts(); }, 30000);

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
  loadPosts();
})();
