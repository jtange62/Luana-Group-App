(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;

  var PROGRAMS = ["Preschool", "Kinder", "After School", "Summer School"];
  // Weekday chips in school order (Mon→Sun); value is JS getDay() index.
  var WEEKDAY_CHIPS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]];
  var WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var $ = function (id) { return document.getElementById(id); };
  var state = { students: [], program: "All", search: "", editingId: null, newDays: [], newSSWeeks: [], newSSType: null };
  var esc = LuanaUtils.esc;

  function daysArr(d) { return d ? String(d).split(",").map(Number).filter(function (n) { return n >= 0 && n <= 6; }) : []; }

  // Age in whole years from a "YYYY-MM-DD" birthday.
  function ageFrom(birthday) {
    if (!birthday) return null;
    var p = String(birthday).split("-");
    if (p.length !== 3) return null;
    var b = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(b.getTime())) return null;
    var now = new Date();
    var age = now.getFullYear() - b.getFullYear();
    var m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 0 ? age : null;
  }

  function prettyBirthday(birthday) {
    if (!birthday) return "";
    var p = String(birthday).split("-");
    if (p.length !== 3) return birthday;
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return MONTHS[+p[1] - 1] + " " + (+p[2]) + ", " + p[0];
  }

  function daysLabel(d) {
    var arr = daysArr(d);
    if (!arr.length) return "—";
    return WEEKDAY_CHIPS.filter(function (wd) { return arr.indexOf(wd[1]) !== -1; })
      .map(function (wd) { return wd[0]; }).join(" ");
  }

  // ---------- Tabs ----------
  function renderTabs() {
    var nav = $("programTabs"); nav.innerHTML = "";
    ["All"].concat(PROGRAMS).forEach(function (p) {
      var b = document.createElement("button");
      b.className = "tab" + (p === state.program ? " active" : "");
      var count = p === "All" ? state.students.length
        : state.students.filter(function (s) { return s.program === p; }).length;
      b.innerHTML = esc(p) + (count ? ' <span class="tab-count">' + count + "</span>" : "");
      b.onclick = function () { state.program = p; render(); };
      nav.appendChild(b);
    });
  }

  // ---------- List ----------
  function matches(s) {
    if (state.program !== "All" && s.program !== state.program) return false;
    var q = state.search.trim().toLowerCase();
    if (!q) return true;
    return [s.name, s.guardian, s.allergies, s.phone, s.email, s.notes]
      .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
  }

  function render() {
    renderTabs();
    var list = $("list"); list.innerHTML = "";
    var shown = state.students.filter(matches);

    $("empty").hidden = state.students.length > 0;
    $("noMatch").hidden = !(state.students.length > 0 && shown.length === 0);

    shown.forEach(function (s) {
      var age = ageFrom(s.birthday);
      var row = document.createElement("button");
      row.className = "stu-row";
      var meta = [s.program, age != null ? age + " yrs" : null].filter(Boolean).join(" · ");
      row.innerHTML =
        '<span class="stu-avatar">' + esc((s.name || "?").charAt(0).toUpperCase()) + "</span>" +
        '<span class="stu-body">' +
          '<span class="stu-name">' + esc(s.name) + "</span>" +
          '<span class="stu-meta">' + esc(meta) + "</span>" +
        "</span>" +
        (s.allergies ? '<span class="stu-flag" title="Has allergy / medical note">⚠️</span>' : "") +
        '<span class="stu-arrow">›</span>';
      row.onclick = function () { openDetail(s); };
      list.appendChild(row);
    });
  }

  // ---------- Detail ----------
  function detailRow(label, value) {
    if (!value) return "";
    return '<div class="d-row"><span class="d-label">' + esc(label) + "</span>" +
      '<span class="d-value">' + esc(value) + "</span></div>";
  }

  function openDetail(s) {
    state.editingId = s.id;
    $("detailName").textContent = s.name;
    var age = ageFrom(s.birthday);
    var html = "";
    html += detailRow("Class", s.program);
    if (s.birthday) html += detailRow("Birthday", prettyBirthday(s.birthday) + (age != null ? "  (" + age + " yrs)" : ""));
    html += detailRow("Days", daysLabel(s.days));
    if (s.enrolled_at) html += detailRow("Enrolled", prettyBirthday(s.enrolled_at));
    html += detailRow("Guardian", s.guardian);
    html += detailRow("Phone", s.phone);
    html += detailRow("Email", s.email);
    html += detailRow("Emergency", s.emergency);
    if (s.allergies) html += '<div class="d-row d-alert"><span class="d-label">Allergies / medical</span>' +
      '<span class="d-value">' + esc(s.allergies) + "</span></div>";
    html += detailRow("Notes", s.notes);
    if (s.program === "Summer School") {
      var SS_DATES = { "1": "Week 1 · 7/27–7/31", "2": "Week 2 · 8/3–8/7", "3": "Week 3 · 8/17–8/21" };
      var weeksLabel = s.ss_weeks
        ? s.ss_weeks.split(",").map(function (w) { return SS_DATES[w] || ("Week " + w); }).join("\n")
        : "—";
      html += detailRow("Weeks attending", weeksLabel);
      if (s.ss_type) html += detailRow("Student type", s.ss_type === "internal" ? "内部生 — Internal" : "外部生 — External");
    }
    html += detailRow("Photo consent", s.photo_ok ? "Yes — OK to post photos" : "No — do not post photos");
    $("detailBody").innerHTML = html;
    $("detail").hidden = false;
  }

  function closeDetail() { $("detail").hidden = true; }

  // ---------- Summer school fields ----------
  function syncSSFields() {
    var isSS = $("fProgram").value === "Summer School";
    $("ssFields").hidden = !isSS;
  }

  function renderSSWeekChips() {
    $("ssFields").querySelectorAll("[data-week]").forEach(function (b) {
      var w = b.getAttribute("data-week");
      b.classList.toggle("active", state.newSSWeeks.indexOf(w) !== -1);
      b.onclick = function () {
        var i = state.newSSWeeks.indexOf(w);
        if (i === -1) { state.newSSWeeks.push(w); } else { state.newSSWeeks.splice(i, 1); }
        renderSSWeekChips();
      };
    });
  }

  function renderSSTypeToggle() {
    $("ssFields").querySelectorAll("[data-type]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-type") === state.newSSType);
      b.onclick = function () {
        state.newSSType = b.getAttribute("data-type");
        renderSSTypeToggle();
      };
    });
  }

  // ---------- Day chips ----------
  function renderDayChips() {
    var c = $("fDays"); c.innerHTML = "";
    WEEKDAY_CHIPS.forEach(function (wd) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "day-chip" + (state.newDays.indexOf(wd[1]) !== -1 ? " active" : "");
      b.textContent = wd[0];
      b.onclick = function () {
        var i = state.newDays.indexOf(wd[1]);
        if (i === -1) { state.newDays.push(wd[1]); b.classList.add("active"); }
        else { state.newDays.splice(i, 1); b.classList.remove("active"); }
      };
      c.appendChild(b);
    });
  }

  // ---------- Add / edit form ----------
  function fillProgramSelect() {
    $("fProgram").innerHTML = PROGRAMS.map(function (p) { return '<option value="' + p + '">' + p + "</option>"; }).join("");
  }

  function openAdd() {
    state.editingId = null;
    state.newDays = [];
    $("formTitle").textContent = "New student";
    $("fName").value = "";
    $("fProgram").value = state.program !== "All" ? state.program : PROGRAMS[0];
    $("fBirthday").value = ""; $("fEnrolled").value = "";
    $("fGuardian").value = ""; $("fPhone").value = ""; $("fEmail").value = "";
    $("fEmergency").value = ""; $("fAllergies").value = ""; $("fNotes").value = "";
    $("fPhotoOk").checked = false;
    state.newSSWeeks = []; state.newSSType = null;
    syncSSFields(); renderSSWeekChips(); renderSSTypeToggle();
    $("formMsg").textContent = ""; $("deleteBtn").hidden = true; $("saveBtn").disabled = false;
    renderDayChips();
    $("modal").hidden = false;
    $("fName").focus();
  }

  function openEdit(s) {
    closeDetail();
    state.editingId = s.id;
    state.newDays = daysArr(s.days);
    $("formTitle").textContent = "Edit student";
    $("fName").value = s.name || "";
    $("fProgram").value = s.program || PROGRAMS[0];
    $("fBirthday").value = s.birthday || ""; $("fEnrolled").value = s.enrolled_at || "";
    $("fGuardian").value = s.guardian || ""; $("fPhone").value = s.phone || ""; $("fEmail").value = s.email || "";
    $("fEmergency").value = s.emergency || ""; $("fAllergies").value = s.allergies || ""; $("fNotes").value = s.notes || "";
    $("fPhotoOk").checked = !!s.photo_ok;
    state.newSSWeeks = s.ss_weeks ? String(s.ss_weeks).split(",") : [];
    state.newSSType = s.ss_type || null;
    syncSSFields(); renderSSWeekChips(); renderSSTypeToggle();
    $("formMsg").textContent = ""; $("deleteBtn").hidden = false; $("saveBtn").disabled = false;
    renderDayChips();
    $("modal").hidden = false;
    $("fName").focus();
  }

  function closeModal() { $("modal").hidden = true; }

  function save() {
    var name = $("fName").value.trim();
    var msg = $("formMsg");
    msg.textContent = "";
    if (!name) { msg.textContent = "Name is required."; return; }

    var payload = {
      id: state.editingId || undefined,
      name: name,
      program: $("fProgram").value,
      days: state.newDays.join(","),
      birthday: $("fBirthday").value,
      enrolled_at: $("fEnrolled").value,
      guardian: $("fGuardian").value.trim(),
      phone: $("fPhone").value.trim(),
      email: $("fEmail").value.trim(),
      emergency: $("fEmergency").value.trim(),
      allergies: $("fAllergies").value.trim(),
      notes: $("fNotes").value.trim(),
      photo_ok: $("fPhotoOk").checked ? 1 : 0,
      ss_weeks: $("fProgram").value === "Summer School" ? state.newSSWeeks.sort().join(",") : "",
      ss_type: $("fProgram").value === "Summer School" ? (state.newSSType || "") : ""
    };

    $("saveBtn").disabled = true;
    LuanaAuth.api("students", { method: state.editingId ? "PATCH" : "POST", body: JSON.stringify(payload) })
      .then(function (res) {
        if (res && res.error) { msg.textContent = res.error; $("saveBtn").disabled = false; return; }
        closeModal(); closeDetail();
        return load();
      })
      .catch(function () { msg.textContent = "Couldn't save. Try again."; $("saveBtn").disabled = false; });
  }

  function removeStudent() {
    if (!state.editingId) return;
    if (!confirm("Remove this student? Their attendance history is kept but they leave the roster.")) return;
    LuanaAuth.api("students", { method: "DELETE", body: JSON.stringify({ id: state.editingId }) })
      .then(function () { closeModal(); closeDetail(); return load(); });
  }

  // ---------- Data ----------
  function load() {
    $("loading").style.display = "block";
    return LuanaAuth.api("students").then(function (res) {
      $("loading").style.display = "none";
      state.students = res.students || [];
      render();
    }).catch(function () { $("loading").style.display = "none"; });
  }

  // ---------- Wire up ----------
  $("addBtn").onclick = openAdd;
  $("cancelBtn").onclick = closeModal;
  $("saveBtn").onclick = save;
  $("deleteBtn").onclick = removeStudent;
  $("modal").onclick = function (e) { if (e.target === $("modal")) closeModal(); };
  $("detailClose").onclick = closeDetail;
  $("detailEdit").onclick = function () {
    var s = state.students.filter(function (x) { return x.id === state.editingId; })[0];
    if (s) openEdit(s);
  };
  $("fProgram").addEventListener("change", function () { syncSSFields(); renderSSWeekChips(); renderSSTypeToggle(); });
  $("search").addEventListener("input", function (e) { state.search = e.target.value; render(); });
  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };

  fillProgramSelect();
  load();
})();
