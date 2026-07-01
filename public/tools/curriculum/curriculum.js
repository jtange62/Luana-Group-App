(function () {
  "use strict";

  // Bounce to hub login if not authenticated.
  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    lessons: [],
    program: PROGRAMS[0],
    editingId: null,   // lesson id when editing an existing theme
    editingMonth: null // "1".."12" for the card being edited
  };

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  // Split a free-text field into items on newlines or commas.
  function items(text) {
    return String(text || "").split(/[\n,]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  // The theme for a program+month: the most recent matching lesson, if any.
  // (loadThemes keeps state.lessons newest-first, matching the API order.)
  function themeFor(program, month) {
    for (var i = 0; i < state.lessons.length; i++) {
      var l = state.lessons[i];
      if (l.program === program && String(l.month || "") === String(month)) return l;
    }
    return null;
  }

  // ---------- Render ----------
  function renderProgramTabs() {
    var nav = $("programTabs"); nav.innerHTML = "";
    PROGRAMS.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "tab" + (state.program === p ? " active" : "");
      b.textContent = p;
      b.onclick = function () { state.program = p; renderProgramTabs(); render(); };
      nav.appendChild(b);
    });
  }

  function fieldBlock(icon, label, inner) {
    return '<div class="cm-field"><span class="cm-field-label">' + icon + " " + label + "</span>" + inner + "</div>";
  }

  function render() {
    $("progHint").textContent = "Monthly plan for " + state.program +
      " — tap a month to set its theme, song, vocab, activities and phonics.";

    var wrap = $("months"); wrap.innerHTML = "";
    var thisMonth = new Date().getMonth() + 1; // 1..12

    for (var m = 1; m <= 12; m++) {
      var l = themeFor(state.program, m);
      var card = document.createElement("article");
      card.className = "month-card" + (m === thisMonth ? " is-current" : "") + (l ? "" : " is-empty");

      var head = '<div class="cm-head">' +
        '<h2 class="cm-month">' + MONTHS[m - 1] + (m === thisMonth ? ' <span class="cm-now">now</span>' : "") + "</h2>" +
        '<button class="cm-edit" title="' + (l ? "Edit" : "Set theme") + '">' + (l ? "✎" : "＋ Set theme") + "</button>" +
        "</div>";

      var bodyHtml;
      if (!l) {
        bodyHtml = '<p class="cm-none">No theme set yet.</p>';
      } else {
        var parts = [];
        parts.push('<div class="cm-theme">' +
          '<span class="cm-theme-name">' + esc(l.title) + "</span>" +
          '<a class="cm-lib" href="/tools/library/?lesson=' + encodeURIComponent(l.id) + '" title="Open in Lesson library">📚 resources</a>' +
          "</div>");
        if (l.song) parts.push(fieldBlock("🎵", "Song", '<p class="cm-text">' + esc(l.song) + "</p>"));
        if (l.vocab) {
          var vocabHtml = items(l.vocab).map(function (v) { return '<span class="cm-chip">' + esc(v) + "</span>"; }).join("");
          parts.push(fieldBlock("🔤", "Vocab", '<div class="cm-chips">' + vocabHtml + "</div>"));
        }
        if (l.activities) {
          var actHtml = items(l.activities).map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("");
          parts.push(fieldBlock("🎨", "Activities", '<ul class="cm-list">' + actHtml + "</ul>"));
        }
        if (l.phonics) parts.push(fieldBlock("🔠", "Phonics", '<p class="cm-text">' + esc(l.phonics) + "</p>"));
        bodyHtml = parts.join("");
      }

      card.innerHTML = head + '<div class="cm-body">' + bodyHtml + "</div>";
      (function (month, lesson) {
        card.querySelector(".cm-edit").onclick = function (e) { e.stopPropagation(); openEdit(month, lesson); };
        card.onclick = function () { openEdit(month, lesson); };
      })(m, l);
      wrap.appendChild(card);
    }
  }

  // ---------- Edit ----------
  function openEdit(month, lesson) {
    state.editingMonth = String(month);
    state.editingId = lesson ? lesson.id : null;
    $("formTitle").textContent = (lesson ? "Edit theme — " : "Set theme — ") + MONTHS[month - 1] + " · " + state.program;
    $("fTitle").value = lesson ? (lesson.title || "") : "";
    $("fSong").value = lesson ? (lesson.song || "") : "";
    $("fVocab").value = lesson ? (lesson.vocab || "") : "";
    $("fActivities").value = lesson ? (lesson.activities || "") : "";
    $("fPhonics").value = lesson ? (lesson.phonics || "") : "";
    $("formMsg").textContent = "";
    $("saveBtn").disabled = false;
    $("modal").hidden = false;
    $("fTitle").focus();
  }

  function closeModal() { $("modal").hidden = true; state.editingId = null; state.editingMonth = null; }

  function save() {
    var title = $("fTitle").value.trim();
    var msg = $("formMsg");
    msg.textContent = "";
    if (!title) { msg.textContent = "A theme name is required."; return; }
    $("saveBtn").disabled = true;

    var fields = {
      title: title,
      song: $("fSong").value.trim(),
      vocab: $("fVocab").value.trim(),
      activities: $("fActivities").value.trim(),
      phonics: $("fPhonics").value.trim()
    };

    if (state.editingId) {
      LuanaAuth.api("lesson", { method: "PATCH", body: JSON.stringify({
        id: state.editingId, author: me,
        title: fields.title, program: state.program, month: state.editingMonth,
        song: fields.song, vocab: fields.vocab, activities: fields.activities, phonics: fields.phonics
      }) })
        .then(function (res) {
          if (res && res.error) throw new Error(res.error);
          closeModal(); return loadThemes();
        })
        .catch(function () { msg.textContent = "Couldn't save. Try again."; $("saveBtn").disabled = false; });
      return;
    }

    // New theme — lesson create is multipart/form-data (files may ride along elsewhere).
    var fd = new FormData();
    fd.append("title", fields.title);
    fd.append("author", me);
    fd.append("program", state.program);
    fd.append("month", state.editingMonth);
    fd.append("song", fields.song);
    fd.append("vocab", fields.vocab);
    fd.append("activities", fields.activities);
    fd.append("phonics", fields.phonics);

    var t = LuanaAuth.token();
    fetch("/api/lesson", {
      method: "POST",
      headers: t ? { Authorization: "Bearer " + t } : {},
      body: fd
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { msg.textContent = res.j.error || "Couldn't save."; $("saveBtn").disabled = false; return; }
        closeModal(); return loadThemes();
      })
      .catch(function () { msg.textContent = "Couldn't reach the server."; $("saveBtn").disabled = false; });
  }

  // ---------- Data ----------
  function loadThemes() {
    $("loading").style.display = "block";
    return LuanaAuth.api("lessons").then(function (res) {
      $("loading").style.display = "none";
      state.lessons = res.lessons || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }

  // ---------- Wire up ----------
  $("cancelBtn").onclick = closeModal;
  $("saveBtn").onclick = save;
  $("modal").onclick = function (e) { if (e.target === $("modal")) closeModal(); };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  renderProgramTabs();
  loadThemes();
})();
