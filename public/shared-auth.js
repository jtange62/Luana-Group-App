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
    login: function (password, name) {
      return fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res.token) return { ok: false, error: res.error || "That password didn't work." };
        set(TOKEN_KEY, res.token);
        set(NAME_KEY, name);
        return { ok: true };
      });
    },

    signOut: function () { del(TOKEN_KEY); del(NAME_KEY); },

    // Send a request to the hub API with the auth header attached.
    // On 401 it signs out and bounces to the hub login.
    api: function (path, opts) {
      opts = opts || {};
      opts.headers = opts.headers || {};
      opts.headers["Content-Type"] = "application/json";
      var t = get(TOKEN_KEY);
      if (t) opts.headers["Authorization"] = "Bearer " + t;
      return fetch("/api/" + path, opts).then(function (r) {
        if (r.status === 401) { LuanaAuth.signOut(); LuanaAuth.requireLogin(); throw new Error("unauthorized"); }
        return r.text().then(function (text) {
          var data = {};
          if (text) {
            try { data = JSON.parse(text); }
            catch (e) { if (r.ok) throw new Error("The server returned an invalid response."); }
          }
          if (!r.ok) {
            var error = new Error(data.error || ("Request failed (" + r.status + ")."));
            error.status = r.status;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
    },

    // Call at the top of a tool page. If not logged in, redirect to the hub.
    requireLogin: function () {
      if (!LuanaAuth.isLoggedIn()) { location.href = "/"; return false; }
      return true;
    }
  };

  global.LuanaAuth = LuanaAuth;
})(window);
