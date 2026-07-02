(function () {
  "use strict";

  // Bounce to hub login if not authenticated.
  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  // Weekly "focus questions" are an After School–only field.
  var QUESTIONS_PROGRAM = "After School";
  function questionsOn() { return state.program === QUESTIONS_PROGRAM; }
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    lessons: [],
    weeks: [],
    program: PROGRAMS[0],
    editingId: null,    // lesson id when editing an existing theme
    editingMonth: null, // "1".."12" for the card being edited
    editingWeekId: null,// week id when editing an existing week
    weekLessonId: null  // theme the week being added/edited belongs to
  };

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  // Split a free-text field into items on newlines or commas.
  function items(text) {
    return String(text || "").split(/[\n,]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  // The theme for a program+month: the most recent matching lesson, if any.
  // (loadAll keeps state.lessons newest-first, matching the API order.)
  function themeFor(program, month) {
    for (var i = 0; i < state.lessons.length; i++) {
      var l = state.lessons[i];
      if (l.program === program && String(l.month || "") === String(month)) return l;
    }
    return null;
  }

  // Weeks belonging to a theme, ordered by week number.
  function weeksFor(lessonId) {
    return state.weeks.filter(function (w) { return w.lesson_id === lessonId; })
      .sort(function (a, b) { return a.week_no - b.week_no; });
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
        parts.push(weeksSection(l));
        bodyHtml = parts.join("");
      }

      card.innerHTML = head + '<div class="cm-body">' + bodyHtml + "</div>";
      (function (month, lesson) {
        card.querySelector(".cm-edit").onclick = function (e) { e.stopPropagation(); openEdit(month, lesson); };
        card.onclick = function () { openEdit(month, lesson); };
        wireWeeks(card, lesson);
      })(m, l);
      wrap.appendChild(card);
    }
  }

  // ---------- Weeks ----------
  function weekRowHtml(w) {
    var parts = [];
    if (w.activities) {
      var actHtml = items(w.activities).map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("");
      parts.push(fieldBlock("🎨", "Activities", '<ul class="cm-list">' + actHtml + "</ul>"));
    }
    if (w.phonics) parts.push(fieldBlock("🔠", "Phonics", '<p class="cm-text">' + esc(w.phonics) + "</p>"));
    if (questionsOn() && w.questions) {
      var qHtml = items(w.questions).map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("");
      parts.push(fieldBlock("❓", "Questions", '<ul class="cm-list">' + qHtml + "</ul>"));
    }
    if (w.notes) parts.push(fieldBlock("📝", "Notes", '<p class="cm-text">' + esc(w.notes) + "</p>"));
    return '<div class="cm-week" data-week="' + esc(w.id) + '">' +
      '<div class="cm-week-top">' +
        '<span class="cm-week-no">Week ' + w.week_no + "</span>" +
        (w.focus ? '<span class="cm-week-focus">' + esc(w.focus) + "</span>" : "") +
        '<span class="cm-week-actions">' +
          '<button class="cm-week-edit" data-week="' + esc(w.id) + '" title="Edit">✎</button>' +
          '<button class="cm-week-del" data-week="' + esc(w.id) + '" title="Delete">✕</button>' +
        "</span>" +
      "</div>" +
      (parts.length ? '<div class="cm-week-body">' + parts.join("") + "</div>" : "") +
      "</div>";
  }

  function weeksSection(lesson) {
    var wks = weeksFor(lesson.id);
    var rows = wks.map(weekRowHtml).join("");
    return '<div class="cm-weeks">' +
      '<div class="cm-weeks-head">' +
        '<span class="cm-field-label">🗓️ Weekly plan</span>' +
        '<button class="cm-week-add">＋ Week</button>' +
      "</div>" +
      (rows || '<p class="cm-week-none">No weeks yet — break the month into weeks.</p>') +
      "</div>";
  }

  function wireWeeks(card, lesson) {
    var weeksEl = card.querySelector(".cm-weeks");
    if (!weeksEl) return;
    // Clicks inside the weeks area shouldn't open the theme editor.
    weeksEl.onclick = function (e) { e.stopPropagation(); };

    var addBtn = weeksEl.querySelector(".cm-week-add");
    if (addBtn) addBtn.onclick = function () { openWeekEdit(lesson.id, null); };

    weeksEl.querySelectorAll(".cm-week-edit").forEach(function (btn) {
      btn.onclick = function () {
        var w = weeksFor(lesson.id).filter(function (x) { return x.id === btn.getAttribute("data-week"); })[0];
        if (w) openWeekEdit(lesson.id, w);
      };
    });
    weeksEl.querySelectorAll(".cm-week-del").forEach(function (btn) {
      btn.onclick = function () { deleteWeek(btn.getAttribute("data-week")); };
    });
  }

  function openWeekEdit(lessonId, week) {
    state.weekLessonId = lessonId;
    state.editingWeekId = week ? week.id : null;
    $("weekFormTitle").textContent = week ? ("Edit Week " + week.week_no) : "Add week";
    $("wFocus").value = week ? (week.focus || "") : "";
    $("wActivities").value = week ? (week.activities || "") : "";
    $("wPhonics").value = week ? (week.phonics || "") : "";
    $("wQuestions").value = week ? (week.questions || "") : "";
    $("wQuestionsField").hidden = !questionsOn();
    $("wNotes").value = week ? (week.notes || "") : "";
    $("weekFormMsg").textContent = "";
    $("weekSaveBtn").disabled = false;
    $("weekModal").hidden = false;
    $("wFocus").focus();
  }

  function closeWeekModal() {
    $("weekModal").hidden = true;
    state.editingWeekId = null; state.weekLessonId = null;
  }

  function saveWeek() {
    var msg = $("weekFormMsg");
    msg.textContent = "";
    var fields = {
      focus: $("wFocus").value.trim(),
      activities: $("wActivities").value.trim(),
      phonics: $("wPhonics").value.trim(),
      questions: questionsOn() ? $("wQuestions").value.trim() : "",
      notes: $("wNotes").value.trim()
    };
    if (!fields.focus && !fields.activities && !fields.phonics && !fields.questions && !fields.notes) {
      msg.textContent = "Add a focus or some detail first."; return;
    }
    $("weekSaveBtn").disabled = true;

    var payload, method;
    if (state.editingWeekId) {
      method = "PATCH";
      payload = { id: state.editingWeekId, focus: fields.focus, activities: fields.activities, phonics: fields.phonics, notes: fields.notes };
    } else {
      method = "POST";
      payload = { lesson_id: state.weekLessonId, author: me, focus: fields.focus, activities: fields.activities, phonics: fields.phonics, notes: fields.notes };
    }
    if (questionsOn()) payload.questions = fields.questions;
    LuanaAuth.api("curriculum-week", { method: method, body: JSON.stringify(payload) })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error);
        closeWeekModal(); return loadWeeks();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("weekSaveBtn").disabled = false; });
  }

  function deleteWeek(id) {
    if (!id || !confirm("Delete this week?")) return;
    LuanaAuth.api("curriculum-week", { method: "DELETE", body: JSON.stringify({ id: id }) })
      .then(function () { return loadWeeks(); })
      .catch(function () {});
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
          closeModal(); return loadAll();
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
        closeModal(); return loadAll();
      })
      .catch(function () { msg.textContent = "Couldn't reach the server."; $("saveBtn").disabled = false; });
  }

  // ---------- Data ----------
  function fetchThemes() {
    return LuanaAuth.api("lessons").then(function (res) { state.lessons = res.lessons || []; });
  }
  function fetchWeeks() {
    return LuanaAuth.api("curriculum-weeks").then(function (res) { state.weeks = res.weeks || []; });
  }
  // Full refresh (themes + weeks) — used at startup and after a theme change.
  function loadAll() {
    $("loading").style.display = "block";
    return Promise.all([fetchThemes(), fetchWeeks()])
      .then(function () { render(); })
      .catch(function () {})
      .then(function () { $("loading").style.display = "none"; });
  }
  // Weeks-only refresh — after adding/editing/deleting a week.
  function loadWeeks() {
    return fetchWeeks().then(render).catch(function () {});
  }

  // ---------- Wire up ----------
  $("cancelBtn").onclick = closeModal;
  $("saveBtn").onclick = save;
  $("modal").onclick = function (e) { if (e.target === $("modal")) closeModal(); };
  $("weekCancelBtn").onclick = closeWeekModal;
  $("weekSaveBtn").onclick = saveWeek;
  $("weekModal").onclick = function (e) { if (e.target === $("weekModal")) closeWeekModal(); };
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  renderProgramTabs();
  loadAll();
})();
