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

  var state = { activeCat: "curriculum", posts: [] };
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

  function renderTabs() {
    var nav = $("tabs"); nav.innerHTML = "";
    CATS.forEach(function (c) {
      var active = c.id === state.activeCat;
      var b = document.createElement("button");
      b.className = "tab" + (active ? " active" : "");
      b.style.borderColor = active ? c.color : "";
      b.style.background = active ? c.soft : "";
      b.style.color = active ? c.dark : "";
      b.innerHTML = '<span class="dot" style="background:' + c.color + '"></span>' + c.label;
      b.onclick = function () { state.activeCat = c.id; renderTabs(); renderFeed(); };
      nav.appendChild(b);
    });
  }

  function renderFeed() {
    var feed = $("feed");
    var items = state.posts
      .filter(function (p) { return p.category === state.activeCat; })
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
    el.innerHTML =
      '<div class="card-head"><div class="who">' +
        '<div class="avatar" style="background:' + c.soft + ";color:" + c.dark + '">' + esc((p.author || "?").charAt(0).toUpperCase()) + "</div>" +
        "<div><p class=\"who-name\">" + esc(p.author) + '</p><p class="who-time">' + timeAgo(p.created_at) + "</p></div></div>" +
        '<span class="cat-pill" style="background:' + c.soft + ";color:" + c.dark + '">' + c.label + "</span>" +
        (p.author === me ? '<button class="edit-btn" title="Edit post">✎</button><button class="del-btn" title="Delete post">✕</button>' : "") +
      "</div>" +
      '<p class="card-text">' + linkify(p.text) + "</p>" +
      (p.author === me ? '<div class="edit-box"><textarea class="edit-ta"></textarea><div class="edit-actions"><button class="edit-save">Save</button><button class="edit-cancel">Cancel</button></div></div>' : "") +
      preview +
      '<div class="comments"></div>';

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
    $("postBtn").disabled = true;
    LuanaAuth.api("post", { method: "POST", body: JSON.stringify({
      category: state.activeCat, author: me, text: text, link: firstUrl(text)
    }) }).then(function () {
      $("ideaInput").value = "";
      $("postBtn").disabled = false;
      return loadPosts();
    }).catch(function () { $("postBtn").disabled = false; });
  }

  $("postingAs").textContent = "Posting as " + me;
  $("postBtn").onclick = post;
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };
  setInterval(function () { if (LuanaAuth.isLoggedIn() && !document.hidden) loadPosts(); }, 30000);

  renderTabs();
  loadPosts();
})();
