(function () {
  "use strict";
  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  var WEEKDAY_CHIPS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]];
  var $ = function (id) { return document.getElementById(id); };
  var state = { program: "Preschool", students: [], editing: null, newDays: [] };

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function daysLabel(days) {
    if (!days) return "";
    var names = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
    return String(days).split(",").map(function (d) { return names[+d] || ""; }).filter(Boolean).join(" · ");
  }

  function ageLabel(birthday) {
    if (!birthday) return "";
    var b = new Date(birthday + "T00:00:00"), n = new Date();
    var age = n.getFullYear() - b.getFullYear();
    if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) age--;
    return age + " yrs";
  }

  function renderDayChips(container, selected, onToggle) {
    container.innerHTML = "";
    WEEKDAY_CHIPS.forEach(function (wd) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "day-chip" + (selected.indexOf(wd[1]) !== -1 ? " active" : "");
      b.textContent = wd[0];
      b.onclick = function () { onToggle(wd[1], b); };
      container.appendChild(b);
    });
  }

  function daysArr(d) { return d ? String(d).split(",").map(Number) : []; }

  // ---------- Tabs ----------
  function renderTabs() {
    var nav = $("programTabs"); nav.innerHTML = "";
    PROGRAMS.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "seg-btn" + (p === state.program ? " active" : "");
      b.textContent = p;
      b.onclick = function () { state.program = p; state.editing = null; render(); };
      nav.appendChild(b);
    });
  }

  // ---------- Student list ----------
  function render() {
    renderTabs();
    var list = $("studentList"); list.innerHTML = "";
    var students = state.students.filter(function (s) { return s.program === state.program; });
    if (!students.length) {
      var empty = document.createElement("p");
      empty.className = "roster-empty";
      empty.textContent = "No students in " + state.program + " yet.";
      list.appendChild(empty);
      return;
    }
    students.forEach(function (s) { list.appendChild(renderCard(s)); });
  }

  function renderCard(s) {
    var card = document.createElement("div");
    card.className = "student-card" + (state.editing === s.id ? " is-editing" : "");

    var hasAllergies = s.allergies && s.allergies.trim();
    var age = ageLabel(s.birthday);

    var summary = document.createElement("div");
    summary.className = "student-summary";
    summary.innerHTML =
      '<div class="student-info">' +
        '<span class="student-name">' + esc(s.name) + (age ? ' <span class="student-age">' + age + '</span>' : "") + "</span>" +
        (hasAllergies ? '<span class="allergy-badge">⚠ ' + esc(s.allergies) + "</span>" : "") +
        (s.days ? '<span class="student-days">' + esc(daysLabel(s.days)) + "</span>" : "") +
      "</div>" +
      '<div class="student-actions">' +
        '<button class="edit-profile-btn" title="Edit profile">✎</button>' +
        '<button class="del-student-btn" title="Remove student">✕</button>' +
      "</div>";

    summary.querySelector(".edit-profile-btn").onclick = function () {
      state.editing = state.editing === s.id ? null : s.id;
      render();
    };
    summary.querySelector(".del-student-btn").onclick = function () {
      if (!confirm("Remove " + s.name + " from the roster?")) return;
      LuanaAuth.api("students", { method: "DELETE", body: JSON.stringify({ id: s.id }) })
        .then(loadStudents);
    };

    card.appendChild(summary);

    if (state.editing === s.id) {
      card.appendChild(renderEditForm(s));
    }

    return card;
  }

  function renderEditForm(s) {
    var form = document.createElement("div");
    form.className = "profile-form";

    var editDays = daysArr(s.days);

    form.innerHTML =
      '<div class="profile-row"><label class="profile-label">Name</label>' +
        '<input class="pf-name profile-input" type="text" value="' + esc(s.name) + '" maxlength="80" /></div>' +
      '<div class="profile-row"><label class="profile-label">Schedule days</label>' +
        '<div class="pf-days day-chips"></div></div>' +
      '<div class="profile-row"><label class="profile-label">Birthday</label>' +
        '<input class="pf-birthday profile-input" type="date" value="' + esc(s.birthday || "") + '" /></div>' +
      '<div class="profile-row"><label class="profile-label">Allergies</label>' +
        '<input class="pf-allergies profile-input" type="text" value="' + esc(s.allergies || "") + '" maxlength="500" placeholder="None" /></div>' +
      '<div class="profile-row"><label class="profile-label">Emergency contact</label>' +
        '<input class="pf-ec profile-input" type="text" value="' + esc(s.emergency_contact || "") + '" maxlength="200" placeholder="Name" /></div>' +
      '<div class="profile-row"><label class="profile-label">Emergency phone</label>' +
        '<input class="pf-ep profile-input" type="tel" value="' + esc(s.emergency_phone || "") + '" maxlength="50" placeholder="Phone number" /></div>' +
      '<div class="profile-row"><label class="profile-label">Notes</label>' +
        '<textarea class="pf-notes profile-input" rows="2" maxlength="2000" placeholder="Any other notes...">' + esc(s.notes || "") + "</textarea></div>" +
      '<div class="profile-actions">' +
        '<button class="pf-save btn-primary btn-sm">Save</button>' +
        '<button class="pf-cancel btn-ghost">Cancel</button>' +
      "</div>";

    renderDayChips(form.querySelector(".pf-days"), editDays, function (dayNum, btn) {
      var i = editDays.indexOf(dayNum);
      if (i === -1) { editDays.push(dayNum); btn.classList.add("active"); }
      else { editDays.splice(i, 1); btn.classList.remove("active"); }
    });

    form.querySelector(".pf-save").onclick = function () {
      var payload = {
        id: s.id,
        name: form.querySelector(".pf-name").value.trim() || s.name,
        program: s.program,
        days: editDays.join(","),
        birthday: form.querySelector(".pf-birthday").value || null,
        allergies: form.querySelector(".pf-allergies").value.trim() || null,
        emergency_contact: form.querySelector(".pf-ec").value.trim() || null,
        emergency_phone: form.querySelector(".pf-ep").value.trim() || null,
        notes: form.querySelector(".pf-notes").value.trim() || null,
      };
      form.querySelector(".pf-save").disabled = true;
      LuanaAuth.api("students", { method: "PATCH", body: JSON.stringify(payload) })
        .then(function () { state.editing = null; return loadStudents(); })
        .catch(function () { form.querySelector(".pf-save").disabled = false; });
    };

    form.querySelector(".pf-cancel").onclick = function () { state.editing = null; render(); };

    return form;
  }

  // ---------- Add student ----------
  function initAddForm() {
    state.newDays = [];
    renderDayChips($("addDays"), state.newDays, function (dayNum, btn) {
      var i = state.newDays.indexOf(dayNum);
      if (i === -1) { state.newDays.push(dayNum); btn.classList.add("active"); }
      else { state.newDays.splice(i, 1); btn.classList.remove("active"); }
    });
  }

  $("addToggleBtn").onclick = function () {
    var form = $("addForm");
    form.hidden = !form.hidden;
    if (!form.hidden) { initAddForm(); $("addName").focus(); }
  };
  $("addCancelBtn").onclick = function () { $("addForm").hidden = true; };
  $("addConfirmBtn").onclick = function () {
    var name = $("addName").value.trim();
    if (!name) return;
    $("addConfirmBtn").disabled = true;
    LuanaAuth.api("students", { method: "POST", body: JSON.stringify({ name: name, program: state.program, days: state.newDays.join(",") }) })
      .then(function () {
        $("addName").value = "";
        $("addForm").hidden = true;
        $("addConfirmBtn").disabled = false;
        return loadStudents();
      })
      .catch(function () { $("addConfirmBtn").disabled = false; });
  };
  $("addName").addEventListener("keydown", function (e) { if (e.key === "Enter") $("addConfirmBtn").click(); });

  // ---------- Data ----------
  function loadStudents() {
    $("loading").style.display = "block";
    return LuanaAuth.api("students").then(function (res) {
      $("loading").style.display = "none";
      state.students = res.students || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }

  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  // Jump to a specific program if ?program= is in the URL.
  var urlParams = new URLSearchParams(location.search);
  var qp = urlParams.get("program");
  if (qp && PROGRAMS.indexOf(qp) !== -1) state.program = qp;

  loadStudents();
})();
