/**
 * eat — client JS (placeholder).
 *
 * The app is server-rendered with no hydration; this is the only client script
 * (the ui renderer escapes inline <script> bodies, so all client JS must live
 * here). Feature agents add delegated DOM listeners below, keyed off CSS classes
 * or data-* attributes. Example pattern:
 *
 *   document.addEventListener("click", (e) => {
 *     const el = e.target.closest("[data-confirm]");
 *     if (el && !confirm(el.dataset.confirm)) e.preventDefault();
 *   });
 */
(function () {
  "use strict";
  // Confirm-on-submit for destructive actions: add data-confirm="Are you sure?"
  // to a <form> or <button>.
  document.addEventListener("submit", function (e) {
    const form = e.target;
    const msg =
      (form && form.getAttribute && form.getAttribute("data-confirm")) ||
      (e.submitter && e.submitter.getAttribute && e.submitter.getAttribute("data-confirm"));
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Copy-to-clipboard: <button type="button" data-copy="text"> copies and flashes "Copied!".
  document.addEventListener("click", function (e) {
    const btn = e.target && e.target.closest && e.target.closest("[data-copy]");
    if (!btn) return;
    const text = btn.getAttribute("data-copy");
    const done = function () {
      const old = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(function () {
        btn.textContent = old;
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done);
    } else {
      // http/older-webview fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    }
  });
})();
