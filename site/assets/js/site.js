// YiiOffice landing page — theme switch, tabs, copy-to-clipboard, reveal.
// No dependencies, no network access.
(function () {
  "use strict";

  var root = document.documentElement;
  var STORAGE_KEY = "yiioffice-site-theme";
  var MODES = ["system", "light", "dark"];
  var LABELS = {
    zh: { system: "主题：跟随系统", light: "主题：亮色", dark: "主题：暗色" },
    en: { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" }
  };
  var lang = (root.getAttribute("lang") || "zh").toLowerCase().indexOf("en") === 0 ? "en" : "zh";

  /* ---------------------------------------------------------------- theme */
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  var toggle = document.getElementById("theme-toggle");
  var mode = "system";

  function resolve(next) {
    if (next === "system") return darkQuery.matches ? "dark" : "light";
    return next;
  }

  function paint() {
    root.setAttribute("data-theme", resolve(mode));
    if (!toggle) return;
    toggle.setAttribute("data-mode", mode);
    toggle.setAttribute("aria-label", LABELS[lang][mode]);
    toggle.setAttribute("title", LABELS[lang][mode]);
  }

  function readMode() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && MODES.indexOf(saved) !== -1) mode = saved;
    } catch (e) {
      /* storage blocked — stay on system */
    }
  }

  function writeMode() {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      /* ignore */
    }
  }

  readMode();
  paint();

  if (toggle) {
    toggle.addEventListener("click", function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      writeMode();
      paint();
    });
  }

  var onSchemeChange = function () {
    if (mode === "system") paint();
  };
  if (typeof darkQuery.addEventListener === "function") {
    darkQuery.addEventListener("change", onSchemeChange);
  } else if (typeof darkQuery.addListener === "function") {
    darkQuery.addListener(onSchemeChange);
  }

  /* ----------------------------------------------------------------- tabs */
  function initTabs(list) {
    var tabs = Array.prototype.slice.call(
      list.querySelectorAll('[role="tab"]')
    );
    if (!tabs.length) return;

    function activate(tab, focus) {
      tabs.forEach(function (other) {
        var isSelf = other === tab;
        other.setAttribute("aria-selected", isSelf ? "true" : "false");
        other.tabIndex = isSelf ? 0 : -1;
        var panel = document.getElementById(other.getAttribute("aria-controls"));
        if (panel) panel.hidden = !isSelf;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        activate(tab, false);
      });

      tab.addEventListener("keydown", function (event) {
        var index = tabs.indexOf(tab);
        var next = -1;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index - 1;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        if (next === -1) return;
        event.preventDefault();
        activate(tabs[(next + tabs.length) % tabs.length], true);
      });
    });
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('[role="tablist"]'),
    initTabs
  );

  /* ----------------------------------------------------------------- copy */
  Array.prototype.forEach.call(
    document.querySelectorAll("[data-copy]"),
    function (button) {
      var label = button.querySelector("[data-copy-label]") || button;
      var original = label.textContent.trim();
      var timer = null;

      button.addEventListener("click", function () {
        var target = document.getElementById(button.getAttribute("data-copy"));
        if (!target) return;
        var text = target.textContent.replace(/\u00a0/g, " ").trim() + "\n";

        function done() {
          button.setAttribute("data-copied", "true");
          label.textContent = lang === "en" ? "Copied" : "已复制";
          window.clearTimeout(timer);
          timer = window.setTimeout(function () {
            button.removeAttribute("data-copied");
            label.textContent = original;
          }, 1600);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback);
        } else {
          fallback();
        }

        function fallback() {
          var area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.top = "-1000px";
          document.body.appendChild(area);
          area.select();
          try {
            document.execCommand("copy");
            done();
          } catch (e) {
            /* clipboard unavailable: leave the button untouched */
          }
          document.body.removeChild(area);
        }
      });
    }
  );

  /* --------------------------------------------------------------- reveal */
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!reveals.length) {
    /* nothing to do */
  } else if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (node) {
      node.classList.add("is-in");
    });
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          revealObserver.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    reveals.forEach(function (node) {
      revealObserver.observe(node);
    });
  }

  /* ------------------------------------------------------------ scrollspy */
  var links = Array.prototype.slice.call(
    document.querySelectorAll('.nav__links a[href^="#"]')
  );

  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    var sections = [];
    links.forEach(function (link) {
      var id = link.getAttribute("href").slice(1);
      var section = document.getElementById(id);
      if (!section) return;
      byId[id] = link;
      sections.push(section);
    });

    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (link) {
            link.removeAttribute("aria-current");
          });
          var link = byId[entry.target.id];
          if (link) link.setAttribute("aria-current", "true");
        });
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );

    sections.forEach(function (section) {
      spy.observe(section);
    });
  }
})();
