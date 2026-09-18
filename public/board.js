// The board — the app's front door.
//
// Capture is one box on purpose: 28 posts went in that way while the curriculum
// tool, which asks for program and month and week before it will take anything,
// stayed empty. So the box stays frictionless and the structure comes after, by
// filing a post into the curriculum once it is clear where it belongs.
(function () {
  "use strict";

  var CATS = [
    { id: "curriculum", label: "curriculum", color: "#0F6E56", soft: "#E1F5EE", dark: "#085041" },
    { id: "events",     label: "events",     color: "#993C1D", soft: "#FAECE7", dark: "#712B13" },
    { id: "supplies",   label: "supplies",   color: "#854F0B", soft: "#FAEEDA", dark: "#633806" },
    { id: "general",    label: "general",    color: "#5F5E5A", soft: "#F1EFE8", dark: "#444441" }
  ];

  // Fields each kind of curriculum row will accept — mirrors post-place.js.
  var PLACE_FIELDS = {
    theme: ["vocab", "activities", "phonics", "song", "notes"],
    week: ["activities", "phonics", "questions", "notes"],
    day: ["vocab", "activities"]
  };
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = {
    requestId: 0, activeCat: "all", posts: [], nextCursor: null, hasMore: false,
    targets: null,     // curriculum destinations, loaded when first needed
    placing: null      // the post being filed
  };
  var resourceView = new URLSearchParams(location.search).get("view") === "resources";
  var resourceType = "photos";
  var search = "";
  var me = LuanaAuth.name();  // reassigned after login on this page
  var $ = function (id) { return document.getElementById(id); };
  var esc = LuanaUtils.esc, timeAgo = LuanaUtils.timeAgo, fileSize = LuanaUtils.fileSize;
  var isImage = LuanaUtils.isImage, firstUrl = LuanaUtils.firstUrl, linkify = LuanaUtils.linkify;

  function cat(id) { return CATS.filter(function (c) { return c.id === id; })[0] || CATS[3]; }

  // Text drafts survive tab changes, refreshes and navigation in this browser tab.
  var drafts = {};
  function saveDrafts() {
    try { sessionStorage.setItem("luana_board_drafts", JSON.stringify({ name: me, values: drafts })); } catch (e) {}
  }
  function clearDraft(id, field) {
    if (drafts[id]) delete drafts[id][field];
    saveDrafts();
  }
  function restoreDrafts() {
    try { var saved = JSON.parse(sessionStorage.getItem("luana_board_drafts") || "null"); drafts = saved && saved.name === me ? saved.values : {}; } catch (e) { drafts = {}; }
    $("ideaInput").value = drafts.composer || "";
  }
  $("ideaInput").addEventListener("input", function () { drafts.composer = this.value; saveDrafts(); });
  $("feed").addEventListener("input", function (event) {
    var card = event.target.closest("[data-post-id]");
    if (!card) return;
    var field = event.target.matches(".edit-ta") ? "edit" : event.target.closest(".reply-box") ? "reply" : event.target.closest(".item-add") ? "items" : null;
    if (!field) return;
    var id = card.dataset.postId;
    drafts[id] = drafts[id] || {}; drafts[id][field] = event.target.value; saveDrafts();
  });
  window.addEventListener("beforeunload", function (event) {
    if (!chosen.length) return;
    event.preventDefault(); event.returnValue = "";
  });

  // ---------- Login gate ----------
  function showBoard() {
    $("gate").style.display = "none";
    $("board").hidden = false;
    LuanaUtils.ping("board");
    $("postingAs").textContent = "Posting as " + me;
    restoreDrafts();
    if (resourceView) { document.querySelector(".composer").hidden = true; document.querySelector(".brand-tag").textContent = "Resources · Photos, files and links shared by the team"; }
    renderTabs();
    loadPosts(true);
  }

  function enter() {
    var pw = $("pwInput").value.trim();
    var name = $("gateName").value.trim();
    var err = $("gateError");
    err.hidden = true;
    if (!pw || !name) { err.textContent = "Enter both the password and your name."; err.hidden = false; return; }
    $("enterBtn").disabled = true;
    LuanaAuth.login(pw, name).then(function (res) {
      $("enterBtn").disabled = false;
      if (!res.ok) {
        err.textContent = res.error === "wrong password" ? "That password didn't work." : res.error;
        err.hidden = false; return;
      }
      me = LuanaAuth.name();
      showBoard();
    }).catch(function () {
      $("enterBtn").disabled = false;
      err.textContent = "Couldn't reach the server. Try again.";
      err.hidden = false;
    });
  }

  function openFile(fileId) {
    var previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    var t = LuanaAuth.token();
    fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        if (previewWindow) previewWindow.location.href = url;
        else { var download = document.createElement("a"); download.href=url; download.download="resource"; download.click(); }
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      })
      .catch(function () { if(previewWindow) previewWindow.close(); LuanaUtils.reportError(null,"Could not open that file. Try again."); });
  }

  // Blob URLs by file id, so the 30s feed refresh reuses already-downloaded
  // images instead of re-fetching every photo on each poll.
  var thumbCache = {};
  var pendingThumbs = {};
  var thumbObserver = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { if (entry.isIntersecting) { thumbObserver.unobserve(entry.target); loadThumb(entry.target, entry.target.dataset.fid); } });
  }, {rootMargin:"240px"}) : null;
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
    if (!pendingThumbs[fileId]) pendingThumbs[fileId] = fetch("/api/file/" + fileId, { headers: t ? { Authorization: "Bearer " + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error("download failed"); return r.blob(); })
      .then(function (blob) { var url = URL.createObjectURL(blob); thumbCache[fileId] = url; return url; })
      .finally(function () { delete pendingThumbs[fileId]; });
    pendingThumbs[fileId].then(function (url) { if (btn.isConnected) applyThumb(btn, url); })
      .catch(function () { btn.textContent = "Preview unavailable"; });
  }

  // ---------- Composer file staging ----------
  var chosen = [];
  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      if(chosen.length>=20 || f.size>50*1024*1024) { LuanaUtils.reportError(null,"Choose up to 20 files, each under 50 MB."); return; }
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

  function renderTabs() {
    var nav = $("tabs"); nav.innerHTML = "";
    if (resourceView) {
      [["photos","Photos"],["files","Files"],["links","Links"]].forEach(function (entry) {
        var button = document.createElement("button");button.className="tab"+(resourceType===entry[0]?" active":"");button.textContent=entry[1];
        button.onclick=function(){resourceType=entry[0];loadPosts(true);};nav.appendChild(button);
      });return;
    }
    [["all","Recent shares"],["tasks","Open tasks"]].forEach(function(entry){
      var button=document.createElement("button");button.className="tab"+(state.activeCat===entry[0]?" active":"");button.textContent=entry[1];
      button.onclick=function(){state.activeCat=entry[0];loadPosts(true);};nav.appendChild(button);
    });


  }

  function renderFeed() {
    var feed = $("feed");
    var items = state.posts
      .filter(function (p) {
        if (state.activeCat === "unfiled") return !p.placed_at;
        return state.activeCat === "all" || state.activeCat === "tasks" || p.category === state.activeCat;
      })
      .sort(function (a, b) { return b.created_at - a.created_at; });
    if (thumbObserver) thumbObserver.disconnect();
    feed.innerHTML = "";
    $("empty").hidden = items.length > 0;
    if (!items.length) {
      $("empty").querySelector("p").textContent = state.activeCat === "unfiled"
        ? "All caught up. New ideas and tasks will appear here."
        : search ? "No matches. Try another name or filename." : resourceView ? "No " + resourceType + " shared yet. Add them from the Staff room." : state.activeCat === "tasks" ? "No open tasks. Use More on a message to make it a task." : "No shares yet. Send a message, photo or file to get started.";
    }
    items.forEach(function (p) { feed.appendChild(card(p)); });
  }

  function card(p) {
    var c = cat(p.category);
    var el = document.createElement("article");
    el.className = "card";
    el.dataset.postId = p.id;
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
      ? '<div class="photo-grid photo-count-' + Math.min(pics.length,3) + '">' + pics.map(function (f) {
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
      '<div class="item-list"></div>' +
      '<div class="card-actions">' +
        (p.placed_at
          ? '<span class="filed-pill" title="Filed or completed">✓ ' + esc(p.placed_note || "filed") + "</span>" +
            '<button class="unfile-btn">Reopen</button>'
          : (p.text ? '<button class="place-btn">Add to curriculum</button>' : '') + ((p.items || []).length ? '<button class="complete-btn">Mark complete</button>' : '')) +
        '<button class="additem-btn">Add checklist</button>' +
      "</div>" +
      '<div class="item-add"><input type="text" placeholder="What needs doing?" /><button>Add</button></div>' +
      '<div class="comments"></div>';

    var menu = document.createElement("details"); menu.className="post-menu";
    var summary = document.createElement("summary"); summary.textContent="More"; menu.appendChild(summary);
    var menuBody = document.createElement("div"); menuBody.className="post-menu-body";menu.appendChild(menuBody);
    [".edit-btn", ".del-btn", ".place-btn", ".additem-btn", ".unfile-btn"].forEach(function(selector){
      var action=el.querySelector(selector);if(!action)return;
      if(selector===".edit-btn")action.textContent="Edit message";
      if(selector===".del-btn")action.textContent="Delete message";
      if(selector===".additem-btn")action.textContent=(p.items||[]).length?"Add checklist items":"Make this a task";
      menuBody.appendChild(action);
      action.addEventListener("click",function(){menu.open=false;});
    });
    el.querySelector(".card-head-right").appendChild(menu);
    el.querySelector(".cat-pill").remove();
    if(!p.text)el.querySelector(".card-text").hidden=true;
    el.querySelectorAll(".photo").forEach(function (btn) { if (thumbObserver) thumbObserver.observe(btn); else loadThumb(btn, btn.getAttribute("data-fid")); });
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
        clearDraft(p.id, "edit");
        editBox.classList.remove("open");
        cardText.style.display = "";
      };
      editBox.querySelector(".edit-save").onclick = function () {
        var ta = editBox.querySelector(".edit-ta");
        var txt = ta.value.trim();
        if (!txt) return;
        ta.disabled = true;
        LuanaAuth.api("post", { method: "PATCH", body: JSON.stringify({ id: p.id, author: me, text: txt }) })
          .then(function () { clearDraft(p.id, "edit"); return loadPosts(true); })
          .catch(function (e) { ta.disabled = false; LuanaUtils.reportError(e, "Could not save your edit."); });
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

    // Checklist — the supplies to gather, the steps to build something.
    var itemWrap = el.querySelector(".item-list");
    (p.items || []).forEach(function (it) {
      var row = document.createElement("label");
      row.className = "item" + (it.done ? " is-done" : "");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!it.done;
      box.onchange = function () {
        row.classList.toggle("is-done", box.checked);
        LuanaAuth.api("post-item", { method: "PATCH", body: JSON.stringify({ id: it.id, done: box.checked }) })
          .catch(function (e) {
            box.checked = !box.checked;
            row.classList.toggle("is-done", box.checked);
            LuanaUtils.reportError(e, "Couldn't save that tick.");
          });
      };
      var text = document.createElement("span");
      text.className = "item-text";
      text.textContent = it.text;
      var x = document.createElement("button");
      x.type = "button";
      x.className = "item-x";
      x.textContent = "✕";
      x.setAttribute("aria-label", "Remove " + it.text);
      x.onclick = function () {
        LuanaAuth.api("post-item", { method: "DELETE", body: JSON.stringify({ id: it.id }) })
          .then(function () { return loadPosts(true); })
          .catch(function (e) { LuanaUtils.reportError(e, "Couldn't remove that item."); });
      };
      row.appendChild(box); row.appendChild(text); row.appendChild(x);
      itemWrap.appendChild(row);
    });

    var addBox = el.querySelector(".item-add");
    el.querySelector(".additem-btn").onclick = function () {
      addBox.classList.toggle("open");
      if (addBox.classList.contains("open")) addBox.querySelector("input").focus();
    };
    function addItems() {
      var input = addBox.querySelector("input");
      var txt = input.value.trim();
      if (!txt) return;
      input.disabled = true;
      LuanaAuth.api("post-item", { method: "POST", body: JSON.stringify({ post_id: p.id, text: txt }) })
        .then(function () { clearDraft(p.id, "items"); return loadPosts(true); })
        .catch(function (e) { input.disabled = false; LuanaUtils.reportError(e, "Couldn't add that."); });
    }
    addBox.querySelector("button").onclick = addItems;
    addBox.querySelector("input").addEventListener("keydown", function (e) { if (e.key === "Enter") addItems(); });

    var placeBtn = el.querySelector(".place-btn");
    if (placeBtn) placeBtn.onclick = function () { openPlace(p); };
    var completeBtn = el.querySelector(".complete-btn");
    if (completeBtn) completeBtn.onclick = function () {
      completeBtn.disabled = true;
      LuanaAuth.api("post-place", { method: "POST", body: JSON.stringify({ post_id: p.id, action: "complete" }) })
        .then(function () { LuanaUtils.reportSuccess("Marked complete."); return loadPosts(true); })
        .catch(function (e) { completeBtn.disabled = false; LuanaUtils.reportError(e, "Couldn't complete this idea."); });
    };
    var unfileBtn = el.querySelector(".unfile-btn");
    if (unfileBtn) unfileBtn.onclick = function () {
      if (p.placed_note !== "Completed" && !confirm("Reopen this idea? Text already added to the curriculum will stay there. Filing it again will add another copy.")) return;
      LuanaAuth.api("post-place", { method: "DELETE", body: JSON.stringify({ post_id: p.id }) })
        .then(function () { return loadPosts(true); })
        .catch(function (e) { LuanaUtils.reportError(e, "Couldn't move that back."); });
    };

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
    toggle.textContent = n ? "Reply (" + n + ")" : "Reply";
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
        .then(function () { clearDraft(p.id, "reply"); return loadPosts(true); })
        .catch(function (e) { input.disabled = false; LuanaUtils.reportError(e, "Could not send your reply."); });
    };
    cwrap.appendChild(toggle);
    cwrap.appendChild(box);
    var draft = drafts[p.id] || {};
    [["edit", ".edit-box", ".edit-ta"], ["reply", ".reply-box", "input"], ["items", ".item-add", "input"]].forEach(function (entry) {
      if (!draft[entry[0]]) return;
      var panel = el.querySelector(entry[1]); panel.classList.add("open");
      panel.querySelector(entry[2]).value = draft[entry[0]];
      if (entry[0] === "edit") cardText.style.display = "none";
    });
    return el;
  }

  // ---------- Send an idea into the curriculum ----------
  function targetLabel(theme, week, day) {
    var month = MONTHS_SHORT[parseInt(theme.month, 10) - 1] || "";
    var head = theme.program + (month ? " · " + month : "") + " — " + theme.title;
    if (day) return "      ↳ " + (day.date || "") + (day.subtheme ? " " + day.subtheme : "");
    if (week) return "   ↳ Week " + week.week_no + (week.focus ? " — " + week.focus : "");
    return head;
  }

  function fillTargets() {
    var sel = $("placeTarget");
    sel.innerHTML = "";
    (state.targets || []).forEach(function (theme) {
      sel.appendChild(new Option(targetLabel(theme), "theme:" + theme.id));
      (theme.weeks || []).forEach(function (week) {
        sel.appendChild(new Option(targetLabel(theme, week), "week:" + week.id));
        (week.days || []).forEach(function (day) {
          sel.appendChild(new Option(targetLabel(theme, week, day), "day:" + day.id));
        });
      });
    });
    var preferred;
    try { preferred = sessionStorage.getItem("luana_place_target"); } catch (e) {}
    if (preferred && Array.from(sel.options).some(function (option) { return option.value === preferred; })) sel.value = preferred;
    else {
      var current = (state.targets || []).find(function (theme) { return Number(theme.month) === new Date().getMonth() + 1; });
      if (current) sel.value = "theme:" + current.id;
    }
    fillFields();
  }

  function fillFields() {
    var value = $("placeTarget").value || "";
    var type = value.split(":")[0];
    var sel = $("placeField");
    sel.innerHTML = "";
    (PLACE_FIELDS[type] || []).forEach(function (f) { sel.appendChild(new Option({activities:"Add activities",vocab:"Add vocabulary",phonics:"Add phonics",song:"Add song",questions:"Add questions",notes:"Add notes"}[f] || f, f)); });
  }

  function openPlace(post) {
    state.placing = post;
    $("placeMsg").textContent = "";
    $("placeGo").disabled = false;
    $("placePreview").textContent = post.text.length > 120 ? post.text.slice(0, 120) + "…" : post.text;
    $("placeModal").hidden = false;


    $("placeTarget").innerHTML = "<option>Loading…</option>";
    LuanaAuth.api("curriculum-targets").then(function (res) {
      state.targets = res.themes || [];
      fillTargets();
      if (!state.targets.length) {
        $("placeMsg").textContent = "No curriculum themes yet — set one up first.";
        $("placeGo").disabled = true;
      }
    }).catch(function (e) {
      $("placeMsg").textContent = "Couldn't load the curriculum.";
      $("placeGo").disabled = true;
      LuanaUtils.reportError(e, "Couldn't load the curriculum.");
    });
  }

  function closePlace() { $("placeModal").hidden = true; state.placing = null; }

  function doPlace() {
    var post = state.placing;
    var value = $("placeTarget").value || "";
    var parts = value.split(":");
    var field = $("placeField").value;
    if (!post || parts.length !== 2 || !field) return;

    try { sessionStorage.setItem("luana_place_target", value); } catch (e) {}
    var label = $("placeTarget").selectedOptions[0].textContent.replace(/^\s*↳\s*/, "").trim() + " · " + field;
    $("placeGo").disabled = true;
    LuanaAuth.api("post-place", { method: "POST", body: JSON.stringify({
      post_id: post.id, type: parts[0], target_id: parts[1], field: field, label: label
    }) })
      .then(function () {
        closePlace();
        LuanaUtils.reportSuccess("Added to " + label + ".");
        return loadPosts(true);
      })
      .catch(function (e) {
        $("placeGo").disabled = false;
        $("placeMsg").textContent = (e && e.message) || "Couldn't file that.";
      });
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

  function postsQuery() {
    var filter = state.activeCat === "tasks" ? "&tasks=1&placed=0" : state.activeCat === "unfiled" ? "&placed=0" : state.activeCat === "all" ? "" : "&category=" + encodeURIComponent(state.activeCat);
    return "posts?limit=30" + filter + (resourceView ? "&resource="+resourceType : "") + (search ? "&q="+encodeURIComponent(search) : "");
  }

  function loadPosts(reset) {
    var requestId = ++state.requestId;
    $("loading").style.display = "block";
    return LuanaAuth.api(postsQuery()).then(function (res) {
      if (requestId !== state.requestId) return;
      $("loading").style.display = "none";
      var incoming = normalizePosts(res.posts || []);
      if (reset) state.posts = incoming; else mergePosts(incoming);
      if (reset) {
        state.nextCursor = res.next_cursor || null;
        state.hasMore = !!res.has_more;
      }
      pruneThumbCache(state.posts);
      renderTabs();
      renderFeed();
      $("loadMore").hidden = !state.hasMore;
      $("loadMore").disabled = false;
    }).catch(function (e) { $("loading").style.display = "none"; LuanaUtils.reportError(e, "Couldn't load ideas."); });
  }

  function loadOlder() {
    if (!state.hasMore || !state.nextCursor) return;
    $("loadMore").disabled = true;
    var requestId = ++state.requestId;
    return LuanaAuth.api(postsQuery() + "&before=" + encodeURIComponent(state.nextCursor)).then(function (res) {
      if (requestId !== state.requestId) return;
      renderTabs();
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
    if (!text && !chosen.length) { LuanaUtils.reportError(null, "Write a message or choose a photo or file."); return; }
    var category = "general";
    $("postBtn").disabled = true;
    var fd = new FormData();
    fd.append("text", text);
    fd.append("author", me);
    fd.append("category", category);
    var link = firstUrl(text);
    if (link) fd.append("link", link);
    chosen.forEach(function (c) { fd.append("files", c.file); });
    var t = LuanaAuth.token();
    $("uploadStatus").hidden = false;
    $("uploadStatus").textContent = "Sending…";
    $("postBtn").textContent = "Sending…";
    new Promise(function (resolve,reject) {
      var xhr=new XMLHttpRequest();xhr.open("POST","/api/post");
      if(t)xhr.setRequestHeader("Authorization","Bearer "+t);
      xhr.upload.onprogress=function(event){if(event.lengthComputable)$("uploadStatus").textContent="Uploading… "+Math.round(event.loaded/event.total*100)+"%";};
      xhr.onload=function(){try{resolve({ok:xhr.status>=200&&xhr.status<300,j:JSON.parse(xhr.responseText)});}catch(e){reject(new Error("Could not read the server response. Please try again."));}};
      xhr.onerror=function(){reject(new Error("Could not connect. Your message and files are still here."));};
      xhr.send(fd);
    })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "Could not post. Please try again.");
        $("ideaInput").value = "";
        delete drafts.composer; saveDrafts();
        clearChosen();
        $("postBtn").disabled = false;
        search=""; $("boardSearch").value=""; state.activeCat="all";
        LuanaUtils.reportSuccess("Shared with the team.");
        return loadPosts(true);
      })
      .catch(function (e) { LuanaUtils.reportError(e, "Could not send. Your draft is still here."); })
      .finally(function () { $("postBtn").disabled = false; $("postBtn").textContent="Send"; $("uploadStatus").hidden=true; });
  }

  document.addEventListener("click", function(event){ document.querySelectorAll(".post-menu[open]").forEach(function(menu){if(!menu.contains(event.target))menu.open=false;}); });
  document.addEventListener("keydown", function(event){if(event.key==="Escape")document.querySelectorAll(".post-menu[open]").forEach(function(menu){menu.open=false;menu.querySelector("summary").focus();});});
  $("postBtn").onclick = post;
  $("loadMore").onclick = loadOlder;
  $("choosePhotos").onclick = function () { $("ideaPhotos").click(); };
  $("chooseFiles").onclick = function () { $("ideaFiles").click(); };
  $("ideaPhotos").onchange = function (e) { addFiles(e.target.files); e.target.value = ""; };
  var searchTimer;
  $("boardSearch").oninput = function () { search=this.value.trim();clearTimeout(searchTimer);searchTimer=setTimeout(function(){loadPosts(true);},250); };
  $("ideaFiles").onchange = function (e) { addFiles(e.target.files); e.target.value = ""; };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.reload(); };

  $("enterBtn").onclick = enter;
  $("pwInput").addEventListener("keydown", function (e) { if (e.key === "Enter") $("gateName").focus(); });
  $("gateName").addEventListener("keydown", function (e) { if (e.key === "Enter") enter(); });

  $("placeCancel").onclick = closePlace;
  $("placeGo").onclick = doPlace;
  $("placeTarget").onchange = fillFields;
  $("placeModal").onclick = function (e) { if (e.target === $("placeModal")) closePlace(); };
  setInterval(function () {
    if (!LuanaAuth.isLoggedIn() || document.hidden) return;
    // Don't re-render (and wipe) a reply or idea someone is mid-typing,
    // or staged file attachments that haven't been posted yet.
    var typing = $("ideaInput").value.trim() || document.querySelector(".reply-box.open, .edit-box.open, .item-add.open, .modal:not([hidden])");
    if (typing || chosen.length || state.hasMore || state.posts.length > 30 || $("postBtn").disabled) return;
    loadPosts(true);
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

  if (LuanaAuth.isLoggedIn()) showBoard();
})();
