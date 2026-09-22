// Shared authentication for the whole Luana Group App hub.
// Every tool loads this script. Login happens once at the hub; the token and
// name live in localStorage and are read by every tool.
(function (global) {
  "use strict";

  var TOKEN_KEY = "luana_token";
  var NAME_KEY = "luana_name";

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var LuanaAuth = {
    token: function () { return get(TOKEN_KEY); },
    name: function () { return get(NAME_KEY) || "anonymous"; },
    isLoggedIn: function () { return !!get(TOKEN_KEY); },

    // Attempt login. Resolves { ok: true } on success, or
    // { ok: false, error: "..." } with the server's message (wrong password,
    // too many attempts, ...) on failure.
    login: function (password, name, username) {
      return fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password, username: username })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res.token) return { ok: false, error: res.error || "That password didn't work." };
        set(TOKEN_KEY, res.token);
        set(NAME_KEY, res.user ? res.user.name : name);
        if(res.user)set("luana_user",JSON.stringify(res.user));
        if(res.user && res.user.must_change)location.href="/tools/account/";
        return { ok: true };
      });
    },

    signOut: function () { del(TOKEN_KEY); del(NAME_KEY); del("luana_user"); try { Object.keys(sessionStorage).filter(function(k){return k.indexOf("luana_")===0;}).forEach(function(k){sessionStorage.removeItem(k);}); } catch (e) {} },

    // Send a request to the hub API with the auth header attached.
    // On 401 it signs out and bounces to the hub login.
    //
    // A FormData body is sent as-is: the browser has to set the multipart
    // Content-Type itself, complete with its boundary. Before this, forcing
    // application/json here meant every upload and every file download built
    // its own fetch by hand and silently lost the 401 and password-change
    // handling below.
    api: function (path, opts) {
      opts = opts || {};
      var headers = {};
      Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
      var isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
      if (!isForm && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      var t = get(TOKEN_KEY);
      if (t) headers["Authorization"] = "Bearer " + t;
      var wantsBlob = opts.as === "blob";
      var request = {};
      Object.keys(opts).forEach(function (k) { if (k !== "as" && k !== "headers") request[k] = opts[k]; });
      request.headers = headers;
      return fetch("/api/" + path, request).then(function (r) {
        if (r.status === 401) { LuanaAuth.signOut(); LuanaAuth.requireLogin(); throw new Error("unauthorized"); }
        if (wantsBlob && r.ok) return r.blob();
        return r.text().then(function (text) {
          var data = {};
          if (text) {
            try { data = JSON.parse(text); }
            catch (e) { if (r.ok) throw new Error("The server returned an invalid response."); }
          }
          if (!r.ok) {
            if(data.password_change_required)location.href="/tools/account/";
            var error = new Error(data.error || ("Request failed (" + r.status + ")."));
            error.status = r.status;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
    },

    // Fetch an uploaded file as an object URL. Same auth and 401 handling as
    // api(); callers revoke the URL when they are done with it.
    fileUrl: function (fileId) {
      return LuanaAuth.api("file/" + encodeURIComponent(fileId), { as: "blob" })
        .then(function (blob) { return URL.createObjectURL(blob); });
    },

    // Multipart upload. Uses XMLHttpRequest rather than fetch only because it is
    // the one way to report upload progress, which matters when a teacher is
    // sending a dozen photos over school wifi. Auth, 401 and error shaping match
    // api() so callers do not have to repeat them.
    upload: function (path, formData, onProgress) {
      var t = get(TOKEN_KEY);
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/" + path);
        if (t) xhr.setRequestHeader("Authorization", "Bearer " + t);
        if (onProgress) xhr.upload.onprogress = function (event) {
          if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
        };
        xhr.onload = function () {
          if (xhr.status === 401) {
            LuanaAuth.signOut(); LuanaAuth.requireLogin();
            reject(new Error("unauthorized")); return;
          }
          var data = {};
          try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; }
          catch (e) { reject(new Error("Could not read the server response. Please try again.")); return; }
          if (xhr.status >= 200 && xhr.status < 300) { resolve(data); return; }
          if (data.password_change_required) location.href = "/tools/account/";
          var error = new Error(data.error || ("Request failed (" + xhr.status + ")."));
          error.status = xhr.status; error.data = data;
          reject(error);
        };
        xhr.onerror = function () { reject(new Error("Could not connect. Your message and files are still here.")); };
        xhr.send(formData);
      });
    },

    // Call at the top of a tool page. If not logged in, redirect to the hub.
    requireLogin: function () {
      if (!LuanaAuth.isLoggedIn()) { location.href = "/"; return false; }
      try{var u=JSON.parse(get("luana_user"));if(u&&u.must_change&&location.pathname!=="/tools/account/"){location.href="/tools/account/";return false;}}catch(e){}
      return true;
    }
  };

  global.LuanaAuth = LuanaAuth;
})(window);
