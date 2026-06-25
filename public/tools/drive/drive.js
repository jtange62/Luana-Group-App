(function () {
  "use strict";

  if (!LuanaAuth.requireLogin()) return;

  var $ = function (id) { return document.getElementById(id); };
  var currentFile = null;
  var uploading = false;
  var history = []; // { name, link, size } — session only

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function pickFile(file) {
    if (!file || uploading) return;
    currentFile = file;
    $("fileInfo").textContent = file.name + " — " + fileSize(file.size);
    $("fileInfo").hidden = false;
    $("dropLabel").hidden = true;
    $("uploadBtn").disabled = false;
    $("result").hidden = true;
  }

  $("dropZone").onclick = function () { if (!uploading) $("filePick").click(); };
  $("dropZone").addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!uploading) $("filePick").click(); }
  });
  $("filePick").onchange = function (e) {
    if (e.target.files[0]) pickFile(e.target.files[0]);
    e.target.value = "";
  };
  $("dropZone").addEventListener("dragover", function (e) {
    e.preventDefault(); $("dropZone").classList.add("drag-over");
  });
  $("dropZone").addEventListener("dragleave", function () {
    $("dropZone").classList.remove("drag-over");
  });
  $("dropZone").addEventListener("drop", function (e) {
    e.preventDefault();
    $("dropZone").classList.remove("drag-over");
    if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
  });

  $("uploadBtn").onclick = function () {
    if (!currentFile || uploading) return;
    startUpload(currentFile);
  };

  function startUpload(file) {
    uploading = true;
    $("uploadBtn").disabled = true;
    $("progressWrap").hidden = false;
    $("progressBar").style.width = "0%";
    $("progressLabel").textContent = "Getting upload URL…";
    $("result").hidden = true;

    LuanaAuth.api("drive-upload-session", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      }),
    }).then(function (res) {
      if (res.error || !res.uploadUrl) throw new Error(res.error || "No upload URL");
      $("progressLabel").textContent = "Uploading 0%";
      doUpload(file, res.uploadUrl);
    }).catch(function (e) {
      uploading = false;
      $("progressLabel").textContent = "Error: " + (e.message || "failed to start");
      $("uploadBtn").disabled = false;
    });
  }

  function doUpload(file, uploadUrl) {
    var xhr = new XMLHttpRequest();

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var pct = Math.round(e.loaded / e.total * 100);
        $("progressBar").style.width = pct + "%";
        $("progressLabel").textContent = "Uploading " + pct + "% — " + fileSize(e.loaded) + " of " + fileSize(e.total);
      }
    };

    xhr.onload = function () {
      uploading = false;
      if (xhr.status >= 200 && xhr.status < 300) {
        var data;
        try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
        var fileId = data.id || "";
        var link = fileId ? "https://drive.google.com/file/d/" + fileId + "/view" : "https://drive.google.com/";
        $("progressBar").style.width = "100%";
        $("progressLabel").textContent = "Done! " + fileSize(file.size) + " uploaded.";
        $("resultLink").href = link;
        $("result").hidden = false;

        history.unshift({ name: file.name, link: link, size: file.size });
        renderHistory();

        currentFile = null;
        $("fileInfo").hidden = true;
        $("dropLabel").hidden = false;
        $("uploadBtn").disabled = true;
      } else {
        $("progressLabel").textContent = "Upload failed (status " + xhr.status + "). Try again.";
        $("uploadBtn").disabled = false;
      }
    };

    xhr.onerror = function () {
      uploading = false;
      $("progressLabel").textContent = "Upload failed — check your connection and try again.";
      $("uploadBtn").disabled = false;
    };

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = String(s || ""); return d.innerHTML; }

  function renderHistory() {
    var el = $("uploads");
    if (!history.length) { el.innerHTML = ""; return; }
    el.innerHTML = '<p class="history-label">This session</p>' +
      history.map(function (h) {
        return '<div class="history-item">' +
          '<span class="history-name">' + esc(h.name) + '</span>' +
          '<span class="history-size">' + fileSize(h.size) + '</span>' +
          '<a class="history-link" href="' + esc(h.link) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>' +
          '</div>';
      }).join("");
  }

  $("signOut").onclick = function () { LuanaAuth.signOut(); location.href = "/"; };
})();
