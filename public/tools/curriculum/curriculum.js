(function () {
  "use strict";

  // Bounce to hub login if not authenticated.
  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  // Weekly "focus questions" are an After School–only field.
  var QUESTIONS_PROGRAM = "After School";
  function questionsOn() { return state.program === QUESTIONS_PROGRAM; }
  // Daily sub-themes (day theme + target vocab) are a Summer School–only
  // layer, along with date-anchored weeks.
  var DAY_THEMES_PROGRAM = "Summer School";
  function dayThemesOn() { return state.program === DAY_THEMES_PROGRAM; }
  // Months a program runs in; unlisted programs run all year.
  var PROGRAM_MONTHS = { "Summer School": [7, 8] };
  function monthsFor(program) {
    return PROGRAM_MONTHS[program] || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  var me = LuanaAuth.name();
  var $ = function (id) { return document.getElementById(id); };
  var esc = LuanaUtils.esc, timeAgo = LuanaUtils.timeAgo;

  var state = {
    lessons: [],
    weeks: [],
    program: PROGRAMS[0],
    editingId: null,    // lesson id when editing an existing theme
    editingMonth: null, // "1".."12" for the card being edited
    editingWeekId: null,// week id when editing an existing week
    weekLessonId: null, // theme the week being added/edited belongs to
    copyLessonId: null, // theme being copied to other programs
    dayThemeWeekId: null, // week whose daily sub-theme is being edited
    editingDayDate: null, // original date of the day row being edited
    openDays: {},       // week ids with the daily-themes section expanded
    openVocab: {},      // lesson ids with the vocab chips expanded
    openDayField: {},   // "weekId|date|kind" keys with a day sub-section expanded
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
  function shortDate(ymd) { var d = parseYMD(ymd); return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate(); }

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

  // The theme + week covering a date. Date-anchored weeks win: a week with a
  // start_date covers start_date..start_date+6 under its own theme, letting a
  // program span month boundaries (Summer School). Otherwise fall back to
  // ceil(dayOfMonth / 7) (days 1–7 → week 1, 8–14 → 2, …), picking the week
  // with the largest week_no <= that (clamps past the last defined week).
  function weekForDate(program, ymd) {
    var d = parseYMD(ymd);

    for (var i = 0; i < state.weeks.length; i++) {
      var w = state.weeks[i];
      if (!w.start_date) continue;
      var start = parseYMD(w.start_date);
      if (d < start || d > addDays(start, 6)) continue;
      var lesson = state.lessons.filter(function (l) { return l.id === w.lesson_id; })[0];
      if (lesson && lesson.program === program) return { theme: lesson, week: w };
    }

    var theme = themeFor(program, d.getMonth() + 1);
    if (!theme) return { theme: null, week: null };
    var n = Math.ceil(d.getDate() / 7);
    var week = null;
    weeksFor(theme.id).forEach(function (w) { if (!w.start_date && w.week_no <= n) week = w; });
    return { theme: theme, week: week };
  }

  // The daily sub-theme (Summer School) covering a date within a week.
  function dayThemeFor(week, ymd) {
    if (!week) return null;
    return (week.days || []).filter(function (d) { return d.date === ymd; })[0] || null;
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
        fetchWeeks().then(function () { if (state.view === "day") loadDay(); else render(); })
          .catch(function (e) { LuanaUtils.reportError(e, "Couldn't load curriculum weeks."); });
      };
      nav.appendChild(b);
    });
  }

  function fieldBlock(icon, label, inner) {
    return '<div class="cm-field"><span class="cm-field-label">' + icon + " " + label + "</span>" + inner + "</div>";
  }

  function render() {
    var months = monthsFor(state.program);
    $("progHint").textContent = months.length === 12
      ? "Monthly plan for " + state.program + " — tap a month to set its theme, song, vocab, activities and phonics."
      : state.program + " runs in " + months.map(function (m) { return MONTHS[m - 1]; }).join(" and ") + " — tap a month to plan it.";

    var wrap = $("months"); wrap.innerHTML = "";
    var thisMonth = new Date().getMonth() + 1; // 1..12

    for (var i = 0; i < months.length; i++) {
      var m = months[i];
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
          // Vocab lists get long — collapsed to a count until tapped.
          var vocabItems = items(l.vocab);
          var vocabOpen = !!state.openVocab[l.id];
          var vocabHtml = vocabItems.map(function (v) { return '<span class="cm-chip">' + esc(v) + "</span>"; }).join("");
          parts.push('<div class="cm-field">' +
            '<button class="cm-toggle" data-toggle="vocab">🔤 Vocab (' + vocabItems.length + ') <span class="cm-toggle-arrow">' + (vocabOpen ? "▾" : "▸") + "</span></button>" +
            (vocabOpen ? '<div class="cm-chips">' + vocabHtml + "</div>" : "") +
            "</div>");
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
        var vocabToggle = card.querySelector('.cm-toggle[data-toggle="vocab"]');
        if (vocabToggle) vocabToggle.onclick = function (e) {
          e.stopPropagation();
          state.openVocab[lesson.id] = !state.openVocab[lesson.id];
          render();
        };
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

    // Daily sub-themes (Summer School): one row per day with theme + vocab.
    var daysHtml = "";
    if (dayThemesOn()) {
      // A collapsible sub-section (activities / vocab) inside one day row.
      function daySection(dr, kind, icon, label, inner, count) {
        var key = w.id + "|" + dr.date + "|" + kind;
        var open = !!state.openDayField[key];
        return '<div class="cm-day-sec">' +
          '<button class="cm-toggle cm-day-sec-toggle" data-key="' + esc(key) + '">' +
            icon + " " + label + " (" + count + ') <span class="cm-toggle-arrow">' + (open ? "▾" : "▸") + "</span></button>" +
          (open ? inner : "") +
          "</div>";
      }
      var dayRows = (w.days || []).map(function (dr) {
        var dd = parseYMD(dr.date);
        var secs = "";
        if (dr.activities) {
          var acts = items(dr.activities);
          secs += daySection(dr, "acts", "🎨", "Activities",
            '<ul class="cm-list">' + acts.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul>", acts.length);
        }
        if (dr.vocab) {
          var words = items(dr.vocab);
          secs += daySection(dr, "vocab", "🔤", "Vocab",
            '<div class="cm-chips">' + words.map(function (v) { return '<span class="cm-chip">' + esc(v) + "</span>"; }).join("") + "</div>", words.length);
        }
        return '<div class="cm-day">' +
          '<div class="cm-day-top">' +
            '<span class="cm-day-date">' + WEEKDAYS[dd.getDay()] + " " + shortDate(dr.date) + "</span>" +
            (dr.subtheme ? '<span class="cm-day-theme">' + esc(dr.subtheme) + "</span>" : "") +
            '<span class="cm-week-actions">' +
              '<button class="cm-day-edit" data-date="' + esc(dr.date) + '" title="Edit">✎</button>' +
              '<button class="cm-day-del" data-date="' + esc(dr.date) + '" title="Delete">✕</button>' +
            "</span>" +
          "</div>" +
          secs +
        "</div>";
      }).join("");
      // Collapsed to a count until tapped — five rows per week adds up fast.
      var daysOpen = !!state.openDays[w.id];
      daysHtml = '<div class="cm-days">' +
        '<div class="cm-days-head">' +
          '<button class="cm-days-toggle cm-toggle">🌞 Daily themes (' + (w.days || []).length + ') <span class="cm-toggle-arrow">' + (daysOpen ? "▾" : "▸") + "</span></button>" +
          '<button class="cm-day-add">＋ Day</button>' +
        "</div>" +
        (daysOpen ? (dayRows || '<p class="cm-week-none">No day themes yet — add one per teaching day.</p>') : "") +
        "</div>";
    }

    return '<div class="cm-week" data-week="' + esc(w.id) + '">' +
      '<div class="cm-week-top">' +
        '<span class="cm-week-no">Week ' + w.week_no + "</span>" +
        (w.start_date ? '<span class="cm-week-dates">' + shortDate(w.start_date) + " – " + shortDate(fmtYMD(addDays(parseYMD(w.start_date), 4))) + "</span>" : "") +
        (w.focus ? '<span class="cm-week-focus">' + esc(w.focus) + "</span>" : "") +
        '<span class="cm-week-actions">' +
          '<button class="cm-week-edit" data-week="' + esc(w.id) + '" title="Edit">✎</button>' +
          '<button class="cm-week-del" data-week="' + esc(w.id) + '" title="Delete">✕</button>' +
        "</span>" +
      "</div>" +
      (parts.length ? '<div class="cm-week-body">' + parts.join("") + "</div>" : "") +
      daysHtml +
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

    // Daily sub-theme rows (Summer School).
    function weekOf(el) {
      var id = el.closest(".cm-week").getAttribute("data-week");
      return weeksFor(lesson.id).filter(function (x) { return x.id === id; })[0];
    }
    weeksEl.querySelectorAll(".cm-days-toggle").forEach(function (btn) {
      btn.onclick = function () {
        var w = weekOf(btn);
        if (!w) return;
        state.openDays[w.id] = !state.openDays[w.id];
        render();
      };
    });
    weeksEl.querySelectorAll(".cm-day-sec-toggle").forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.getAttribute("data-key");
        state.openDayField[key] = !state.openDayField[key];
        render();
      };
    });
    weeksEl.querySelectorAll(".cm-day-add").forEach(function (btn) {
      btn.onclick = function () { var w = weekOf(btn); if (w) openDayTheme(w, null); };
    });
    weeksEl.querySelectorAll(".cm-day-edit").forEach(function (btn) {
      btn.onclick = function () {
        var w = weekOf(btn);
        if (!w) return;
        var day = (w.days || []).filter(function (d) { return d.date === btn.getAttribute("data-date"); })[0];
        if (day) openDayTheme(w, day);
      };
    });
    weeksEl.querySelectorAll(".cm-day-del").forEach(function (btn) {
      btn.onclick = function () {
        var w = weekOf(btn);
        if (w) deleteDayTheme(w.id, btn.getAttribute("data-date"));
      };
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
          .catch(function (e) { LuanaUtils.reportError(e, "Couldn't delete the comment."); });
      };
    });
  }

  function openWeekEdit(lessonId, week) {
    state.weekLessonId = lessonId;
    state.editingWeekId = week ? week.id : null;
    $("weekFormTitle").textContent = week ? ("Edit Week " + week.week_no) : "Add week";
    $("wFocus").value = week ? (week.focus || "") : "";
    $("wStartField").hidden = !dayThemesOn();
    $("wStart").value = week ? (week.start_date || "") : "";
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
    if (dayThemesOn()) payload.start_date = $("wStart").value || "";
    LuanaAuth.api("curriculum-week", { method: method, body: JSON.stringify(payload) })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error);
        closeWeekModal(); return loadWeeks();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("weekSaveBtn").disabled = false; });
  }

  function deleteWeek(id) {
    if (!id || !confirm("Permanently delete this week and its daily themes? This cannot be undone.")) return;
    LuanaAuth.api("curriculum-week", { method: "DELETE", body: JSON.stringify({ id: id }) })
      .then(function () { LuanaUtils.reportSuccess("Curriculum week deleted."); return loadWeeks(); })
      .catch(function (e) { LuanaUtils.reportError(e, "Couldn't delete the week. Nothing was changed."); });
  }

  // ---------- Daily sub-themes (Summer School) ----------
  // Default date for a new day row: the weekday after the week's last one.
  function nextDayDate(week) {
    var days = week.days || [];
    if (!days.length) return week.start_date || "";
    var d = addDays(parseYMD(days[days.length - 1].date), 1);
    if (d.getDay() === 6) d = addDays(d, 2); // skip Saturday
    if (d.getDay() === 0) d = addDays(d, 1); // skip Sunday
    return fmtYMD(d);
  }

  function openDayTheme(week, day) {
    state.dayThemeWeekId = week.id;
    state.editingDayDate = day ? day.date : null;
    state.openDays[week.id] = true; // show the result after saving
    $("dayThemeFormTitle").textContent = (day ? "Edit day theme" : "Add day theme") + " — Week " + week.week_no;
    $("dtDate").value = day ? day.date : nextDayDate(week);
    $("dtTheme").value = day ? (day.subtheme || "") : "";
    $("dtActivities").value = day ? (day.activities || "") : "";
    $("dtVocab").value = day ? (day.vocab || "") : "";
    $("dayThemeFormMsg").textContent = "";
    $("dayThemeSaveBtn").disabled = false;
    $("dayThemeModal").hidden = false;
    $("dtTheme").focus();
  }

  function closeDayThemeModal() {
    $("dayThemeModal").hidden = true;
    state.dayThemeWeekId = null; state.editingDayDate = null;
  }

  function saveDayTheme() {
    var msg = $("dayThemeFormMsg");
    msg.textContent = "";
    var weekId = state.dayThemeWeekId;
    var date = $("dtDate").value;
    var subtheme = $("dtTheme").value.trim();
    var activities = $("dtActivities").value.trim();
    var vocab = $("dtVocab").value.trim();
    if (!date || (!subtheme && !vocab && !activities)) { msg.textContent = "A date and some content are required."; return; }
    $("dayThemeSaveBtn").disabled = true;

    // week+date is the row's key — moving a row to a new date removes the old one.
    var pre = state.editingDayDate && state.editingDayDate !== date
      ? LuanaAuth.api("week-day", { method: "DELETE", body: JSON.stringify({ week_id: weekId, date: state.editingDayDate }) })
      : Promise.resolve();
    pre.then(function () {
      return LuanaAuth.api("week-day", { method: "POST", body: JSON.stringify({ week_id: weekId, date: date, subtheme: subtheme, vocab: vocab, activities: activities, author: me }) });
    })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error);
        closeDayThemeModal(); return loadWeeks();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("dayThemeSaveBtn").disabled = false; });
  }

  function deleteDayTheme(weekId, date) {
    if (!weekId || !date || !confirm("Permanently delete the day theme for " + prettyDate(date) + "? This cannot be undone.")) return;
    LuanaAuth.api("week-day", { method: "DELETE", body: JSON.stringify({ week_id: weekId, date: date }) })
      .then(function () { LuanaUtils.reportSuccess("Day theme deleted."); return loadWeeks(); })
      .catch(function (e) { LuanaUtils.reportError(e, "Couldn't delete the day theme. Nothing was changed."); });
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
      // A month outside the target program's season would be invisible there.
      var offSeason = monthsFor(p).indexOf(Number(lesson.month)) === -1;
      var off = taken || offSeason;
      var row = document.createElement("label");
      row.className = "copy-target" + (off ? " taken" : "");
      row.innerHTML = '<input type="checkbox" value="' + esc(p) + '"' + (off ? " disabled" : "") + " /> " +
        esc(p) +
        (taken ? ' <span class="copy-taken">already has a theme</span>'
          : offSeason ? ' <span class="copy-taken">not in season this month</span>' : "");
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
    month_phonics:    { icon: "🔠", label: "Phonics", name: "month phonics", kind: "text", from: "theme", field: "phonics" },
    day_subtheme:     { icon: "🌞", label: "Day theme", name: "day theme", kind: "text", from: "day", field: "subtheme" },
    day_vocab:        { icon: "🔤", label: "Target vocab", name: "day's target vocab", kind: "chips", from: "day", field: "vocab" },
    day_activities:   { icon: "🎨", label: "Activities", name: "day's activities", kind: "list", from: "day", field: "activities" }
  };

  // The auto-filled content of a block for the shown date.
  function blockContent(block, theme, week, day) {
    var meta = SOURCE_META[block.source];
    if (!meta) return "";
    var src = meta.from === "week" ? week : meta.from === "day" ? day : theme;
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

  function blockRowHtml(block, theme, week, day) {
    var entry = noteFor(block.id);
    var actions = state.rhythmEdit
      ? '<span class="cm-week-actions">' +
          '<button class="db-edit" data-block="' + esc(block.id) + '" title="Edit">✎</button>' +
          '<button class="db-del" data-block="' + esc(block.id) + '" title="Delete">✕</button>' +
        "</span>"
      : "";

    // The day entry: today's plan, what actually happened, reminder note.
    var dayHtml = "";
    if (entry) {
      if (entry.planned) dayHtml += fieldBlock("🎯", "Today's plan", '<p class="cm-text">' + esc(entry.planned) + "</p>");
      if (entry.actual) dayHtml += '<div class="db-did">' + fieldBlock("✅", "What we did", '<p class="cm-text">' + esc(entry.actual) + "</p>") + "</div>";
      if (entry.text) dayHtml += '<div class="db-note-pill">📌 ' + esc(entry.text) + "</div>";
    }
    var editBtn = entry
      ? '<button class="db-note has-entry" data-block="' + esc(block.id) + '">✎ Edit today</button>'
      : '<button class="db-note" data-block="' + esc(block.id) + '">＋ Plan / record today</button>';

    return '<div class="day-block">' +
      '<div class="db-time">' + esc(block.start_time) +
        (block.end_time ? '<span class="db-time-end">–' + esc(block.end_time) + "</span>" : "") +
      "</div>" +
      '<div class="db-main">' +
        '<div class="db-top"><span class="db-label">' + esc(block.label) + "</span>" + actions + "</div>" +
        blockContent(block, theme, week, day) +
        dayHtml +
        editBtn +
      "</div></div>";
  }

  function renderDay() {
    $("dayDate").value = state.date;
    $("rhythmEditBtn").classList.toggle("active", state.rhythmEdit);

    var ctx = weekForDate(state.program, state.date);
    var dayTheme = dayThemeFor(ctx.week, state.date);
    if (!ctx.theme) {
      var mNo = parseYMD(state.date).getMonth() + 1;
      $("dayContext").textContent = monthsFor(state.program).indexOf(mNo) === -1
        ? prettyDate(state.date) + " — outside the " + state.program + " season."
        : prettyDate(state.date) + " — no theme set for " + MONTHS[mNo - 1] + " yet. Switch to Plan to add one.";
    } else {
      $("dayContext").textContent = prettyDate(state.date) + " — " + ctx.theme.title +
        (ctx.week ? " · Week " + ctx.week.week_no + (ctx.week.focus ? ": " + ctx.week.focus : "") : "") +
        (dayTheme && dayTheme.subtheme ? " · 🌞 " + dayTheme.subtheme : "");
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
      wrap.innerHTML = sorted.map(function (b) { return blockRowHtml(b, ctx.theme, ctx.week, dayTheme); }).join("") +
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
      var active = b.getAttribute("data-view") === v;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
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
  // Day planning only needs rules that can produce an occurrence on this date.
  function fetchDayEvents() {
    return LuanaAuth.api("events?from=" + state.date + "&to=" + state.date)
      .then(function (res) { state.events = res.events || []; });
  }
  function loadDay() {
    $("loading").style.display = "block";
    return Promise.all([fetchBlocks(), fetchDayEvents()])
      .then(renderDay)
      .catch(function (e) { LuanaUtils.reportError(e, "Couldn't load the day plan."); })
      .then(function () { $("loading").style.display = "none"; });
  }
  function setDate(ymd) { state.date = ymd; loadDay(); }

  function openBlockEdit(block) {
    state.editingBlockId = block ? block.id : null;
    $("blockFormTitle").textContent = (block ? "Edit block" : "Add block") + " — " + state.program;
    $("bLabel").value = block ? (block.label || "") : "";
    $("bStart").value = block ? (block.start_time || "") : "";
    $("bEnd").value = block ? (block.end_time || "") : "";
    // Program-gated sources: week questions is After School–only, day themes
    // are Summer School–only. Hide elsewhere unless this block already uses one.
    var qOpt = $("bSource").querySelector('option[value="week_questions"]');
    qOpt.hidden = !questionsOn() && !(block && block.source === "week_questions");
    ["day_subtheme", "day_vocab", "day_activities"].forEach(function (v) {
      var opt = $("bSource").querySelector('option[value="' + v + '"]');
      opt.hidden = !dayThemesOn() && !(block && block.source === v);
    });
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
    if (!id || !confirm("Permanently delete this schedule block and all of its day notes? This cannot be undone.")) return;
    LuanaAuth.api("schedule-block", { method: "DELETE", body: JSON.stringify({ id: id }) })
      .then(function () { LuanaUtils.reportSuccess("Schedule block deleted."); return loadDay(); })
      .catch(function (e) { LuanaUtils.reportError(e, "Couldn't delete the schedule block. Nothing was changed."); });
  }

  function openNoteEdit(block) {
    state.noteBlockId = block.id;
    var entry = noteFor(block.id);
    $("noteFormTitle").textContent = block.label + " · " + prettyDate(state.date);
    $("nPlanned").value = entry ? (entry.planned || "") : "";
    $("nActual").value = entry ? (entry.actual || "") : "";
    $("nText").value = entry ? (entry.text || "") : "";
    $("noteRemoveBtn").hidden = !entry;
    $("noteFormMsg").textContent = "";
    $("noteSaveBtn").disabled = false;
    $("noteModal").hidden = false;
    $("nPlanned").focus();
  }

  function closeNoteModal() { $("noteModal").hidden = true; state.noteBlockId = null; }

  // Saving a fully-emptied entry deletes it; otherwise the whole entry
  // (plan / actual / note) is upserted — one per block+date.
  function saveNote() {
    var blockId = state.noteBlockId;
    var planned = $("nPlanned").value.trim();
    var actual = $("nActual").value.trim();
    var text = $("nText").value.trim();
    var hasAny = !!(planned || actual || text);
    if (!hasAny && !noteFor(blockId)) { closeNoteModal(); return; }
    var msg = $("noteFormMsg");
    msg.textContent = "";
    $("noteSaveBtn").disabled = true;

    var req = hasAny
      ? LuanaAuth.api("day-note", { method: "POST", body: JSON.stringify({ block_id: blockId, date: state.date, planned: planned, actual: actual, text: text, author: me }) })
      : LuanaAuth.api("day-note", { method: "DELETE", body: JSON.stringify({ block_id: blockId, date: state.date }) });
    req.then(function (res) {
        if (res && res.error) throw new Error(res.error);
        closeNoteModal(); return loadDay();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("noteSaveBtn").disabled = false; });
  }

  function removeNote() {
    if (!confirm("Permanently delete today’s plan, record, and note? This cannot be undone.")) return;
    $("nPlanned").value = ""; $("nActual").value = ""; $("nText").value = "";
    saveNote();
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
    return LuanaAuth.api("lessons?files=0").then(function (res) { state.lessons = res.lessons || []; });
  }
  function fetchWeeks() {
    return LuanaAuth.api("curriculum-weeks?program=" + encodeURIComponent(state.program))
      .then(function (res) { state.weeks = res.weeks || []; });
  }
  // Re-render whichever view is showing (day view also slots theme/week data).
  function rerender() { if (state.view === "day") renderDay(); else render(); }

  // Full refresh (themes + weeks) — used at startup and after a theme change.
  function loadAll() {
    $("loading").style.display = "block";
    return Promise.all([fetchThemes(), fetchWeeks()])
      .then(rerender)
      .catch(function (e) { LuanaUtils.reportError(e, "Couldn't load curriculum."); })
      .then(function () { $("loading").style.display = "none"; });
  }
  // Weeks-only refresh — after adding/editing/deleting a week.
  function loadWeeks() {
    return fetchWeeks().then(rerender).catch(function (e) { LuanaUtils.reportError(e, "Couldn't refresh curriculum weeks."); });
  }

  // ---------- Wire up ----------
  $("cancelBtn").onclick = closeModal;
  $("saveBtn").onclick = save;
  $("modal").onclick = function (e) { if (e.target === $("modal")) closeModal(); };
  $("weekCancelBtn").onclick = closeWeekModal;
  $("weekSaveBtn").onclick = saveWeek;
  $("weekModal").onclick = function (e) { if (e.target === $("weekModal")) closeWeekModal(); };

  $("dayThemeCancelBtn").onclick = closeDayThemeModal;
  $("dayThemeSaveBtn").onclick = saveDayTheme;
  $("dayThemeModal").onclick = function (e) { if (e.target === $("dayThemeModal")) closeDayThemeModal(); };

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
