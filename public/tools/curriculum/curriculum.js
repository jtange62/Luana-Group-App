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
    weekLessonId: null, // theme the week being added/edited belongs to
    copyLessonId: null, // theme being copied to other programs
    view: "plan",       // "plan" (month cards) | "day" (daily rhythm)
    date: null,         // "YYYY-MM-DD" shown in the day view (set below)
    blocks: [],         // daily-rhythm template blocks for state.program
    dayNotes: [],       // one-off notes for state.date's blocks
    events: null,       // all calendar events; null until first day-view load
    rhythmEdit: false,  // day view: template editing mode
    editingBlockId: null,
    noteBlockId: null   // block whose note is being edited
  };

  // ---------- Dates (copied from calendar.js — keep in sync) ----------
  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtYMD(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYMD(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function prettyDate(ymd) { var d = parseYMD(ymd); return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate(); }

  // Recurrence check (copied from calendar.js — keep in sync).
  function occursOn(ev, d) {
    var start = parseYMD(ev.start_date);
    if (d < start) return false;
    if (ev.recur_until && d > parseYMD(ev.recur_until)) return false;
    var r = ev.recur || "none";
    if (r === "none") return d.getTime() === start.getTime();
    if (r === "daily") return true;
    if (r === "weekly") return d.getDay() === start.getDay();
    if (r === "monthly") return d.getDate() === start.getDate();
    return false;
  }

  state.date = fmtYMD(new Date());

  // Escapes quotes too — esc() output is also used inside HTML attributes.
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  // Copied from ideas.js — keep in sync.
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

  // The theme + week covering a date. Week rule: ceil(dayOfMonth / 7)
  // (days 1–7 → week 1, 8–14 → 2, …), then the week with the largest
  // week_no <= that (clamps past the last defined week, tolerates gaps).
  function weekForDate(program, ymd) {
    var d = parseYMD(ymd);
    var theme = themeFor(program, d.getMonth() + 1);
    if (!theme) return { theme: null, week: null };
    var n = Math.ceil(d.getDate() / 7);
    var week = null;
    weeksFor(theme.id).forEach(function (w) { if (w.week_no <= n) week = w; });
    return { theme: theme, week: week };
  }

  // ---------- Render ----------
  function renderProgramTabs() {
    var nav = $("programTabs"); nav.innerHTML = "";
    PROGRAMS.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "tab" + (state.program === p ? " active" : "");
      b.textContent = p;
      b.onclick = function () {
        state.program = p;
        renderProgramTabs();
        if (state.view === "day") loadDay(); else render();
      };
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
          '<span class="cm-theme-links">' +
            '<button class="cm-copy" title="Copy to other programs">⧉ copy</button>' +
            '<a class="cm-lib" href="/tools/library/?lesson=' + encodeURIComponent(l.id) + '" title="Open in Lesson library">📚 resources</a>' +
          "</span></div>");
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
        var copyBtn = card.querySelector(".cm-copy");
        if (copyBtn) copyBtn.onclick = function (e) { e.stopPropagation(); openCopy(lesson); };
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

    // Retro notes: what worked / what didn't. Thread is always visible; the
    // reply box opens on demand.
    var cms = w.comments || [];
    var commentsHtml = '<div class="cm-comments" data-week="' + esc(w.id) + '">' +
      cms.map(function (c) {
        return '<div class="cm-comment"><b>' + esc(c.author) + '</b> <span class="cm-comment-text">' + esc(c.text) + "</span>" +
          '<span class="cm-comment-when">' + esc(timeAgo(Number(c.created_at))) + "</span>" +
          '<button class="cm-comment-del" data-id="' + esc(c.id) + '" title="Delete">✕</button></div>';
      }).join("") +
      '<button class="cm-reply-toggle">💬 ' + (cms.length ? cms.length + (cms.length === 1 ? " note" : " notes") + " — add one" : "add a retro note") + "</button>" +
      '<div class="cm-reply-box"><input type="text" maxlength="2000" placeholder="what worked / what didn\'t…" /><button>Send</button></div>' +
      "</div>";

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
      commentsHtml +
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

    // Retro-note threads (one .cm-comments per week).
    weeksEl.querySelectorAll(".cm-reply-toggle").forEach(function (btn) {
      btn.onclick = function () {
        var box = btn.parentElement.querySelector(".cm-reply-box");
        box.classList.toggle("open");
        if (box.classList.contains("open")) box.querySelector("input").focus();
      };
    });
    weeksEl.querySelectorAll(".cm-reply-box button").forEach(function (btn) {
      btn.onclick = function () {
        var input = btn.parentElement.querySelector("input");
        var txt = input.value.trim();
        if (!txt) return;
        input.disabled = true;
        var weekId = btn.closest(".cm-comments").getAttribute("data-week");
        LuanaAuth.api("week-comment", { method: "POST", body: JSON.stringify({ week_id: weekId, author: me, text: txt }) })
          .then(function (res) {
            if (res && res.error) throw new Error(res.error);
            return loadWeeks();
          })
          .catch(function () { input.disabled = false; });
      };
    });
    weeksEl.querySelectorAll(".cm-comment-del").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Delete this comment?")) return;
        LuanaAuth.api("week-comment", { method: "DELETE", body: JSON.stringify({ id: btn.getAttribute("data-id") }) })
          .then(function () { return loadWeeks(); })
          .catch(function () {});
      };
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

  // ---------- Copy theme to other programs ----------
  function openCopy(lesson) {
    state.copyLessonId = lesson.id;
    $("copyFormTitle").textContent = 'Copy "' + lesson.title + '" — ' + MONTHS[Number(lesson.month) - 1];
    var wkCount = weeksFor(lesson.id).length;
    $("copyHint").textContent = "Copies the theme" +
      (wkCount ? " and its " + wkCount + "-week plan" : "") + " to:";
    var wrap = $("copyTargets"); wrap.innerHTML = "";
    PROGRAMS.filter(function (p) { return p !== lesson.program; }).forEach(function (p) {
      var taken = !!themeFor(p, Number(lesson.month));
      var row = document.createElement("label");
      row.className = "copy-target" + (taken ? " taken" : "");
      row.innerHTML = '<input type="checkbox" value="' + esc(p) + '"' + (taken ? " disabled" : "") + " /> " +
        esc(p) + (taken ? ' <span class="copy-taken">already has a theme</span>' : "");
      wrap.appendChild(row);
    });
    $("copyFormMsg").textContent = "";
    $("copyGoBtn").disabled = false;
    $("copyModal").hidden = false;
  }

  function closeCopyModal() { $("copyModal").hidden = true; state.copyLessonId = null; }

  // Create a copy of the theme (and its weeks, in order) under each chosen
  // program. Runs sequentially so week auto-numbering stays in order.
  function doCopy() {
    var lesson = state.lessons.filter(function (l) { return l.id === state.copyLessonId; })[0];
    var msg = $("copyFormMsg");
    if (!lesson) { closeCopyModal(); return; }
    var targets = [];
    $("copyTargets").querySelectorAll("input:checked").forEach(function (i) { targets.push(i.value); });
    if (!targets.length) { msg.textContent = "Pick at least one program."; return; }
    $("copyGoBtn").disabled = true;
    msg.textContent = "Copying…";

    var wks = weeksFor(lesson.id);
    var t = LuanaAuth.token();
    var chain = Promise.resolve();
    targets.forEach(function (p) {
      chain = chain.then(function () {
        // Lesson create is multipart (same as save()).
        var fd = new FormData();
        fd.append("title", lesson.title || "");
        fd.append("author", me);
        fd.append("program", p);
        fd.append("month", lesson.month || "");
        fd.append("song", lesson.song || "");
        fd.append("vocab", lesson.vocab || "");
        fd.append("activities", lesson.activities || "");
        fd.append("phonics", lesson.phonics || "");
        return fetch("/api/lesson", {
          method: "POST",
          headers: t ? { Authorization: "Bearer " + t } : {},
          body: fd
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (!res || !res.id) throw new Error("copy failed");
          var wchain = Promise.resolve();
          wks.forEach(function (w) {
            wchain = wchain.then(function () {
              return LuanaAuth.api("curriculum-week", { method: "POST", body: JSON.stringify({
                lesson_id: res.id, author: me,
                focus: w.focus || "", activities: w.activities || "",
                phonics: w.phonics || "", questions: w.questions || "", notes: w.notes || ""
              }) });
            });
          });
          return wchain;
        });
      });
    });

    chain.then(function () { closeCopyModal(); return loadAll(); })
      .catch(function () { msg.textContent = "Couldn't copy. Try again."; $("copyGoBtn").disabled = false; });
  }

  // ---------- Day view ----------
  // What each block `source` pulls from and how it renders.
  var SOURCE_META = {
    week_focus:       { icon: "🎯", label: "Week focus", name: "week focus", kind: "text", from: "week", field: "focus" },
    week_activities:  { icon: "🎨", label: "Activities", name: "week activities", kind: "list", from: "week", field: "activities" },
    week_phonics:     { icon: "🔠", label: "Phonics", name: "week phonics", kind: "text", from: "week", field: "phonics" },
    week_questions:   { icon: "❓", label: "Questions", name: "week questions", kind: "list", from: "week", field: "questions" },
    month_theme:      { icon: "🍎", label: "Theme", name: "month theme", kind: "text", from: "theme", field: "title" },
    month_song:       { icon: "🎵", label: "Song", name: "song of the month", kind: "text", from: "theme", field: "song" },
    month_vocab:      { icon: "🔤", label: "Vocab", name: "month vocab", kind: "chips", from: "theme", field: "vocab" },
    month_activities: { icon: "🎨", label: "Activities", name: "month activities", kind: "list", from: "theme", field: "activities" },
    month_phonics:    { icon: "🔠", label: "Phonics", name: "month phonics", kind: "text", from: "theme", field: "phonics" }
  };

  // The auto-filled content of a block for the shown date.
  function blockContent(block, theme, week) {
    var meta = SOURCE_META[block.source];
    if (!meta) return "";
    var src = meta.from === "week" ? week : theme;
    var val = src ? src[meta.field] : null;
    if (!val) return '<p class="cm-none">No ' + meta.name + " set for this date.</p>";
    var inner;
    if (meta.kind === "chips") {
      inner = '<div class="cm-chips">' + items(val).map(function (v) { return '<span class="cm-chip">' + esc(v) + "</span>"; }).join("") + "</div>";
    } else if (meta.kind === "list") {
      inner = '<ul class="cm-list">' + items(val).map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>";
    } else {
      inner = '<p class="cm-text">' + esc(val) + "</p>";
    }
    return fieldBlock(meta.icon, meta.label, inner);
  }

  function noteFor(blockId) {
    return state.dayNotes.filter(function (n) { return n.block_id === blockId && n.date === state.date; })[0] || null;
  }

  // Events surfaced in the day view: school-wide (general calendar) plus the
  // current program's student events. Staff shifts stay in the Calendar tool.
  function dayEventsFor(ymd) {
    var d = parseYMD(ymd);
    return (state.events || []).filter(function (ev) {
      if (!occursOn(ev, d)) return false;
      var cal = ev.calendar || "students";
      if (cal === "general") return true;
      return cal === "students" && (ev.program === state.program || ev.program === "General");
    }).sort(function (a, b) { // all-day first, then by start time (as calendar.js)
      var ta = a.start_time || "", tb = b.start_time || "";
      if (!ta && tb) return -1;
      if (ta && !tb) return 1;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }

  function blockRowHtml(block, theme, week) {
    var note = noteFor(block.id);
    var actions = state.rhythmEdit
      ? '<span class="cm-week-actions">' +
          '<button class="db-edit" data-block="' + esc(block.id) + '" title="Edit">✎</button>' +
          '<button class="db-del" data-block="' + esc(block.id) + '" title="Delete">✕</button>' +
        "</span>"
      : "";
    var noteBtn = note
      ? '<button class="db-note has-note" data-block="' + esc(block.id) + '">📌 ' + esc(note.text) + "</button>"
      : '<button class="db-note" data-block="' + esc(block.id) + '">＋ Add note for this day</button>';
    return '<div class="day-block">' +
      '<div class="db-time">' + esc(block.start_time) +
        (block.end_time ? '<span class="db-time-end">–' + esc(block.end_time) + "</span>" : "") +
      "</div>" +
      '<div class="db-main">' +
        '<div class="db-top"><span class="db-label">' + esc(block.label) + "</span>" + actions + "</div>" +
        blockContent(block, theme, week) +
        noteBtn +
      "</div></div>";
  }

  function renderDay() {
    $("dayDate").value = state.date;
    $("rhythmEditBtn").classList.toggle("active", state.rhythmEdit);

    var ctx = weekForDate(state.program, state.date);
    if (!ctx.theme) {
      $("dayContext").textContent = prettyDate(state.date) + " — no theme set for " +
        MONTHS[parseYMD(state.date).getMonth()] + " yet. Switch to Plan to add one.";
    } else {
      $("dayContext").textContent = prettyDate(state.date) + " — " + ctx.theme.title +
        (ctx.week ? " · Week " + ctx.week.week_no + (ctx.week.focus ? ": " + ctx.week.focus : "") : "");
    }

    $("dayEvents").innerHTML = dayEventsFor(state.date).map(function (ev) {
      var time = ev.start_time ? esc(ev.start_time) + (ev.end_time ? "–" + esc(ev.end_time) : "") : "All day";
      return '<div class="day-ev"><span class="day-ev-time">' + time + "</span>" +
        '<span class="day-ev-title">' + esc(ev.title) + "</span>" +
        (ev.notes ? '<span class="day-ev-notes">' + esc(ev.notes) + "</span>" : "") +
        "</div>";
    }).join("");

    var wrap = $("dayBlocks");
    if (!state.blocks.length) {
      wrap.innerHTML = '<div class="day-empty">No daily rhythm for ' + esc(state.program) +
        " yet — add the first time block.</div>" +
        '<button class="day-add-block">＋ Add block</button>';
    } else {
      var sorted = state.blocks.slice().sort(function (a, b) {
        return a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.created_at - b.created_at;
      });
      wrap.innerHTML = sorted.map(function (b) { return blockRowHtml(b, ctx.theme, ctx.week); }).join("") +
        (state.rhythmEdit ? '<button class="day-add-block">＋ Add block</button>' : "");
    }

    var addBtn = wrap.querySelector(".day-add-block");
    if (addBtn) addBtn.onclick = function () { openBlockEdit(null); };
    function blockById(btn) {
      return state.blocks.filter(function (x) { return x.id === btn.getAttribute("data-block"); })[0];
    }
    wrap.querySelectorAll(".db-edit").forEach(function (btn) {
      btn.onclick = function () { var b = blockById(btn); if (b) openBlockEdit(b); };
    });
    wrap.querySelectorAll(".db-del").forEach(function (btn) {
      btn.onclick = function () { deleteBlock(btn.getAttribute("data-block")); };
    });
    wrap.querySelectorAll(".db-note").forEach(function (btn) {
      btn.onclick = function () { var b = blockById(btn); if (b) openNoteEdit(b); };
    });
  }

  function switchView(v) {
    state.view = v;
    document.querySelectorAll("#viewToggle .vt-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === v);
    });
    var day = v === "day";
    $("months").hidden = day;
    $("progHint").hidden = day;
    $("dayView").hidden = !day;
    if (day) loadDay(); else render();
  }

  function fetchBlocks() {
    return LuanaAuth.api("schedule-blocks?program=" + encodeURIComponent(state.program) + "&date=" + state.date)
      .then(function (res) { state.blocks = res.blocks || []; state.dayNotes = res.notes || []; });
  }
  // Events are fetched once per session — plenty fresh for day planning.
  function fetchEventsOnce() {
    if (state.events) return Promise.resolve();
    return LuanaAuth.api("events").then(function (res) { state.events = res.events || []; });
  }
  function loadDay() {
    $("loading").style.display = "block";
    return Promise.all([fetchBlocks(), fetchEventsOnce()])
      .then(renderDay)
      .catch(function () {})
      .then(function () { $("loading").style.display = "none"; });
  }
  function setDate(ymd) { state.date = ymd; loadDay(); }

  function openBlockEdit(block) {
    state.editingBlockId = block ? block.id : null;
    $("blockFormTitle").textContent = (block ? "Edit block" : "Add block") + " — " + state.program;
    $("bLabel").value = block ? (block.label || "") : "";
    $("bStart").value = block ? (block.start_time || "") : "";
    $("bEnd").value = block ? (block.end_time || "") : "";
    // Week questions is an After School–only field; hide the option elsewhere
    // unless this block already uses it.
    var qOpt = $("bSource").querySelector('option[value="week_questions"]');
    qOpt.hidden = !questionsOn() && !(block && block.source === "week_questions");
    $("bSource").value = block && block.source ? block.source : "";
    $("blockFormMsg").textContent = "";
    $("blockSaveBtn").disabled = false;
    $("blockModal").hidden = false;
    $("bLabel").focus();
  }

  function closeBlockModal() { $("blockModal").hidden = true; state.editingBlockId = null; }

  function saveBlock() {
    var msg = $("blockFormMsg");
    msg.textContent = "";
    var label = $("bLabel").value.trim();
    var start = $("bStart").value;
    if (!label || !start) { msg.textContent = "A label and start time are required."; return; }
    $("blockSaveBtn").disabled = true;

    var payload = { label: label, start_time: start, end_time: $("bEnd").value || "", source: $("bSource").value || "" };
    var method;
    if (state.editingBlockId) { method = "PATCH"; payload.id = state.editingBlockId; }
    else { method = "POST"; payload.program = state.program; payload.author = me; }
    LuanaAuth.api("schedule-block", { method: method, body: JSON.stringify(payload) })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error);
        closeBlockModal(); return loadDay();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("blockSaveBtn").disabled = false; });
  }

  function deleteBlock(id) {
    if (!id || !confirm("Delete this block? Its day notes go too.")) return;
    LuanaAuth.api("schedule-block", { method: "DELETE", body: JSON.stringify({ id: id }) })
      .then(function () { return loadDay(); })
      .catch(function () {});
  }

  function openNoteEdit(block) {
    state.noteBlockId = block.id;
    var note = noteFor(block.id);
    $("noteFormTitle").textContent = "Note — " + block.label + " · " + prettyDate(state.date);
    $("nText").value = note ? note.text : "";
    $("noteRemoveBtn").hidden = !note;
    $("noteFormMsg").textContent = "";
    $("noteSaveBtn").disabled = false;
    $("noteModal").hidden = false;
    $("nText").focus();
  }

  function closeNoteModal() { $("noteModal").hidden = true; state.noteBlockId = null; }

  // Saving an emptied note deletes it; saving text upserts it (one per block+date).
  function saveNote() {
    var blockId = state.noteBlockId;
    var text = $("nText").value.trim();
    if (!text && !noteFor(blockId)) { closeNoteModal(); return; }
    var msg = $("noteFormMsg");
    msg.textContent = "";
    $("noteSaveBtn").disabled = true;

    var req = text
      ? LuanaAuth.api("day-note", { method: "POST", body: JSON.stringify({ block_id: blockId, date: state.date, text: text, author: me }) })
      : LuanaAuth.api("day-note", { method: "DELETE", body: JSON.stringify({ block_id: blockId, date: state.date }) });
    req.then(function (res) {
        if (res && res.error) throw new Error(res.error);
        closeNoteModal(); return loadDay();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("noteSaveBtn").disabled = false; });
  }

  function removeNote() { $("nText").value = ""; saveNote(); }

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
  // Re-render whichever view is showing (day view also slots theme/week data).
  function rerender() { if (state.view === "day") renderDay(); else render(); }

  // Full refresh (themes + weeks) — used at startup and after a theme change.
  function loadAll() {
    $("loading").style.display = "block";
    return Promise.all([fetchThemes(), fetchWeeks()])
      .then(rerender)
      .catch(function () {})
      .then(function () { $("loading").style.display = "none"; });
  }
  // Weeks-only refresh — after adding/editing/deleting a week.
  function loadWeeks() {
    return fetchWeeks().then(rerender).catch(function () {});
  }

  // ---------- Wire up ----------
  $("cancelBtn").onclick = closeModal;
  $("saveBtn").onclick = save;
  $("modal").onclick = function (e) { if (e.target === $("modal")) closeModal(); };
  $("weekCancelBtn").onclick = closeWeekModal;
  $("weekSaveBtn").onclick = saveWeek;
  $("weekModal").onclick = function (e) { if (e.target === $("weekModal")) closeWeekModal(); };

  $("copyCancelBtn").onclick = closeCopyModal;
  $("copyGoBtn").onclick = doCopy;
  $("copyModal").onclick = function (e) { if (e.target === $("copyModal")) closeCopyModal(); };

  document.querySelectorAll("#viewToggle .vt-btn").forEach(function (b) {
    b.onclick = function () { switchView(b.getAttribute("data-view")); };
  });
  $("dayPrev").onclick = function () { setDate(fmtYMD(addDays(parseYMD(state.date), -1))); };
  $("dayNext").onclick = function () { setDate(fmtYMD(addDays(parseYMD(state.date), 1))); };
  $("dayToday").onclick = function () { setDate(fmtYMD(new Date())); };
  $("dayDate").onchange = function () { if ($("dayDate").value) setDate($("dayDate").value); };
  $("rhythmEditBtn").onclick = function () { state.rhythmEdit = !state.rhythmEdit; renderDay(); };
  $("blockCancelBtn").onclick = closeBlockModal;
  $("blockSaveBtn").onclick = saveBlock;
  $("blockModal").onclick = function (e) { if (e.target === $("blockModal")) closeBlockModal(); };
  $("noteCancelBtn").onclick = closeNoteModal;
  $("noteSaveBtn").onclick = saveNote;
  $("noteRemoveBtn").onclick = removeNote;
  $("noteModal").onclick = function (e) { if (e.target === $("noteModal")) closeNoteModal(); };

  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  renderProgramTabs();
  loadAll();
})();
