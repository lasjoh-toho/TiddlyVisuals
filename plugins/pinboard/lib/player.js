/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/player.js
type: application/javascript
module-type: library

The Pinboard presentation player.

ONE implementation for both places a presentation runs: inside the wiki
(presenter.js) and in exported standalone HTML files, which embed this
file verbatim. So it must not use TiddlyWiki APIs, only the DOM and the
camera module it is handed.

  var player = Player.create(Camera, {
      document, window, root, viewport, world,
      steps:   [{rect, rot, padding, title, focus, occlude: [key]}],
      objects: [{key, build, exit}],    // build/exit: step index or -1
      overview: rect,                    // whole board
      getCamera(), setCamera(camera),    // optional
      standalone: bool, fullscreen: bool, onStop: fn });
  player.start(index);

Keys name board objects: "s:<shape id>" or "c:<card title>".

\*/

"use strict";

var INTERACTIVE = "a, button, input, textarea, select, summary, label, [contenteditable='true']";
var PEN_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#111827", "#ffffff"];
var SVGNS = "http://www.w3.org/2000/svg";
var PREVIEW_W = 240, PREVIEW_H = 150;

var ICONS = {
	left: "M19 12H5M11 6l-6 6 6 6",
	right: "M5 12h14M13 6l6 6-6 6",
	fit: "M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3zM9 3.5v14M15 6.5v14",
	close: "M6 6l12 12M18 6L6 18",
	pen: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
	highlighter: "M4 20h7M9 15l-3 3 2 2 3-3M9 15l7-11 4 3-8 11z",
	text: "M5 6V4h14v2M12 4v16M9 20h6",
	eraser: "M8 20h12M5 15l9-9 5 5-8 8H8z",
	trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
	fullscreen: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
};

exports.create = function(Camera, env) {
	return new Player(Camera, env);
};

function Player(Camera, env) {
	this.Camera = Camera;
	this.env = env;
	this.doc = env.document;
	this.win = env.window;
	this.root = env.root;
	this.viewport = env.viewport;
	this.world = env.world;
	this.steps = env.steps || [];
	this.objects = env.objects || [];
	this.index = -1;
	this.previews = {};
	this.pointers = {};
	this.pen = {on: false, tool: "pen", color: PEN_COLORS[0], size: 4};
	this.camera = env.getCamera ? env.getCamera() : {x: 0, y: 0, s: 1, r: 0};
	this.listeners = [];
}

var P = Player.prototype;

/*** Lifecycle ***/

P.start = function(index) {
	var self = this;
	this.root.classList.add("pb-presenting");
	this.buildUi();
	this.ink = svg(this.doc, "svg", {"class": "pb-svg pb-layer-ink"});
	this.world.appendChild(this.ink);
	this.listen(this.viewport, "pointerdown", this.onPointerDown);
	this.listen(this.viewport, "pointermove", this.onPointerMove);
	this.listen(this.viewport, "pointerup", this.onPointerUp);
	this.listen(this.viewport, "pointercancel", this.onPointerUp);
	this.listen(this.viewport, "wheel", this.onWheel, {passive: false});
	this.listen(this.env.keyTarget || this.root, "keydown", this.onKey);
	this.listen(this.doc, "fullscreenchange", this.onFullscreenChange);
	this.listen(this.win, "resize", function() {
		clearTimeout(self.resizeTimer);
		self.resizeTimer = setTimeout(function() { self.reaim(); }, 80);
	});
	if (this.env.fullscreen) {
		this.enterFullscreen();
	}
	try {
		this.root.focus({preventScroll: true});
	} catch (e) {}
	this.goTo(Math.max(0, Math.min(this.steps.length - 1, index || 0)));
};

P.stop = function() {
	if (this.stopped) {
		return;
	}
	this.stopped = true;
	if (this.animation) {
		this.win.cancelAnimationFrame(this.animation);
	}
	this.finishText && this.finishText();
	for (var i = 0; i < this.listeners.length; i++) {
		var l = this.listeners[i];
		l[0].removeEventListener(l[1], l[2], l[3]);
	}
	this.listeners = [];
	// Only leave fullscreen if the presentation entered it.
	if (this.enteredFullscreen && this.doc.fullscreenElement === this.root && this.doc.exitFullscreen) {
		try {
			var promise = this.doc.exitFullscreen();
			promise && promise.catch && promise.catch(function() {});
		} catch (e) {}
	}
	remove(this.ui);
	remove(this.ink);
	this.applyState(null);
	this.root.classList.remove("pb-presenting");
	this.root.classList.remove("pb-pen-on");
	this.env.onStop && this.env.onStop();
};

P.listen = function(target, type, method, options) {
	var bound = method.bind(this);
	target.addEventListener(type, bound, options);
	this.listeners.push([target, type, bound, options]);
};

/*** Camera ***/

P.viewSize = function() {
	return {w: this.viewport.clientWidth || 1, h: this.viewport.clientHeight || 1};
};

P.setCamera = function(camera) {
	this.camera = camera;
	if (this.env.setCamera) {
		this.env.setCamera(camera);
	} else {
		this.world.style.transform = this.Camera.transform(camera);
		var grid = 24 * camera.s;
		while (grid < 12) {
			grid *= 4;
		}
		this.viewport.style.backgroundSize = grid + "px " + grid + "px";
		this.viewport.style.backgroundPosition = camera.x + "px " + camera.y + "px";
	}
};

P.getCamera = function() {
	return this.env.getCamera ? this.env.getCamera() : this.camera;
};

P.animateTo = function(target, instant) {
	var self = this;
	if (this.animation) {
		this.win.cancelAnimationFrame(this.animation);
		this.animation = null;
	}
	var size = this.viewSize();
	var interpolate = this.Camera.interpolate(this.getCamera(), target, size.w, size.h);
	var duration = interpolate.duration;
	if (instant || (this.win.matchMedia && this.win.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
		this.setCamera(target);
		return;
	}
	var start = null;
	var step = function(now) {
		if (start === null) {
			start = now;
		}
		var t = Math.min(1, (now - start) / duration);
		var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
		self.setCamera(interpolate(e));
		self.animation = t < 1 ? self.win.requestAnimationFrame(step) : null;
	};
	this.animation = this.win.requestAnimationFrame(step);
};

P.cameraForStep = function(step, w, h) {
	return this.Camera.fitRect(step.rect, w, h, step.padding, 8, step.rot || 0);
};

/*** Navigation ***/

P.goTo = function(index, instant) {
	if (this.steps.length === 0) {
		return;
	}
	index = Math.max(0, Math.min(this.steps.length - 1, index));
	this.index = index;
	var size = this.viewSize();
	this.animateTo(this.cameraForStep(this.steps[index], size.w, size.h), instant);
	this.applyState(index);
	this.updateUi();
};

P.next = function() {
	if (this.index < this.steps.length - 1) {
		this.goTo(this.index + 1);
	} else if (this.index === this.steps.length - 1) {
		// Past the last stop: everything that builds is in, show it all.
		this.index = this.steps.length;
		this.applyState(this.index);
		this.showOverview();
		this.updateUi();
	}
};

P.prev = function() {
	this.goTo(Math.min(this.index, this.steps.length) - 1);
};

P.showOverview = function() {
	var rect = this.env.overview;
	if (rect) {
		var size = this.viewSize();
		this.animateTo(this.Camera.fitRect(rect, size.w, size.h, 0.05, 8, 0));
	}
};

/*
A stop's target changed size after arriving (e.g. images inside it
loaded): take the new rectangle and, if it is the current stop, aim
again.
*/
P.updateStepRect = function(index, rect) {
	var step = this.steps[index];
	if (!step || !rect) {
		return;
	}
	var r = step.rect;
	if (Math.abs(r.x - rect.x) < 0.5 && Math.abs(r.y - rect.y) < 0.5 && Math.abs(r.w - rect.w) < 0.5 && Math.abs(r.h - rect.h) < 0.5) {
		return;
	}
	step.rect = rect;
	delete this.previews[index];
	if (index === this.index) {
		var size = this.viewSize();
		this.animateTo(this.cameraForStep(step, size.w, size.h));
	}
};

P.reaim = function() {
	if (this.index >= 0 && this.index < this.steps.length) {
		this.goTo(this.index, true);
	}
};

/*** Builds, exits, covers ***/

P.resolve = function(key, scope) {
	scope = scope || this.world;
	var kind = key.charAt(0), id = key.substr(2);
	var quoted = (this.win.CSS && this.win.CSS.escape) ? this.win.CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
	if (kind === "s") {
		return scope.querySelector("[data-pb-shape=\"" + quoted + "\"]");
	}
	if (kind === "c") {
		return scope.querySelector(".pb-card[data-pb-id=\"" + quoted + "\"]");
	}
	return null;
};

/*
Shows the board as it is at step `index` (null clears every effect).
*/
P.applyState = function(index, scope) {
	var i, el;
	for (i = 0; i < this.objects.length; i++) {
		var o = this.objects[i];
		el = this.resolve(o.key, scope);
		if (!el) {
			continue;
		}
		var hiddenBefore = index !== null && o.build >= 0 && index < o.build;
		var hiddenAfter = index !== null && o.exit >= 0 && index >= o.exit;
		toggle(el, "pb-build-hidden", hiddenBefore);
		toggle(el, "pb-exit-hidden", hiddenAfter);
	}
	var root = scope || this.world;
	var covered = root.querySelectorAll(".pb-occluded, .pb-spotlight");
	for (i = 0; i < covered.length; i++) {
		covered[i].classList.remove("pb-occluded");
		covered[i].classList.remove("pb-spotlight");
	}
	var step = index !== null ? this.steps[index] : null;
	if (step) {
		(step.occlude || []).forEach(function(key) {
			var c = this.resolve(key, scope);
			c && c.classList.add("pb-occluded");
		}, this);
		if (step.focus && step.focus.charAt(0) === "c") {
			var f = this.resolve(step.focus, scope);
			f && f.classList.add("pb-spotlight");
		}
	}
};

/*** Chrome ***/

P.buildUi = function() {
	var doc = this.doc, self = this;
	var labels = this.env.labels || {};
	this.counter = el(doc, "span", "pb-present-counter");
	this.titleEl = el(doc, "span", "pb-present-title");
	var info = el(doc, "div", "pb-present-info", [this.counter, this.titleEl]);
	info.title = labels.stack || "All stops";
	this.stack = el(doc, "div", "pb-present-stack");
	var bar = el(doc, "div", "pb-present-bar", [
		button(doc, "left", labels.prev || "Previous (\u2190)", function() { self.prev(); }),
		info,
		button(doc, "right", labels.next || "Next (\u2192, Space)", function() { self.next(); }),
		button(doc, "fit", labels.overview || "Overview (O)", function() { self.showOverview(); }),
		button(doc, "fullscreen", labels.fullscreen || "Fullscreen on/off (F)", function() { self.toggleFullscreen(); }),
		this.env.standalone ? null :
			button(doc, "close", labels.exit || "End presentation (Esc)", function() { self.stop(); })
	]);
	this.progress = el(doc, "div", "pb-present-progress", [this.stack, bar]);
	info.addEventListener("mouseenter", function() { self.openStack(true); });
	info.addEventListener("click", function() { self.openStack(!self.progress.classList.contains("pb-open")); });
	this.progress.addEventListener("mouseleave", function() { self.openStack(false); });
	this.preview = el(doc, "div", "pb-present-preview");
	this.ui = el(doc, "div", "pb-present-ui pb-chrome", [
		el(doc, "div", "pb-zone pb-zone-left", null, function() { self.prev(); }),
		el(doc, "div", "pb-zone pb-zone-right", null, function() { self.next(); }),
		this.progress,
		this.preview,
		this.buildPenUi()
	]);
	this.root.appendChild(this.ui);
};

P.updateUi = function() {
	var count = this.steps.length;
	if (this.index >= count) {
		this.counter.textContent = (this.env.labels && this.env.labels.end) || "End";
		this.titleEl.textContent = "";
	} else {
		this.counter.textContent = (this.index + 1) + " / " + count;
		this.titleEl.textContent = this.steps[this.index] ? (this.steps[this.index].title || "") : "";
	}
	if (this.progress.classList.contains("pb-open")) {
		this.renderStack();
	}
	this.env.onStep && this.env.onStep(this.index);
};

P.openStack = function(open) {
	toggle(this.progress, "pb-open", open);
	if (open) {
		this.renderStack();
	} else {
		this.preview.classList.remove("pb-visible");
	}
};

/*
All stops as a stack of bars, the last one on top; hovering one shows a
live preview of that stop (flip through them like a flipbook).
*/
P.renderStack = function() {
	var doc = this.doc, self = this;
	var stack = this.stack;
	while (stack.firstChild) {
		stack.removeChild(stack.firstChild);
	}
	for (var i = this.steps.length - 1; i >= 0; i--) {
		(function(index) {
			var seg = el(doc, "div", "pb-seg" +
				(index < self.index ? " pb-seg-played" : "") +
				(index === self.index ? " pb-seg-current" : ""));
			seg.title = (index + 1) + ". " + (self.steps[index].title || "");
			seg.addEventListener("mouseenter", function() { self.showPreview(index); });
			seg.addEventListener("mouseleave", function() { self.preview.classList.remove("pb-visible"); });
			seg.addEventListener("click", function() {
				self.preview.classList.remove("pb-visible");
				self.goTo(index);
			});
			stack.appendChild(seg);
		})(i);
	}
};

P.showPreview = function(index) {
	var preview = this.preview;
	while (preview.firstChild) {
		preview.removeChild(preview.firstChild);
	}
	preview.appendChild(this.previewFor(index));
	preview.appendChild(el(this.doc, "div", "pb-present-preview-title", [(index + 1) + ". " + (this.steps[index].title || "")]));
	preview.classList.add("pb-visible");
};

/*
A miniature of the live board, cropped to the stop and in that stop's
build state.
*/
P.previewFor = function(index) {
	if (this.previews[index]) {
		return this.previews[index];
	}
	var frame = el(this.doc, "div", "pb-preview-frame");
	var clone = this.world.cloneNode(true);
	var strip = clone.querySelectorAll(".pb-layer-ui, .pb-layer-ink");
	for (var i = 0; i < strip.length; i++) {
		remove(strip[i]);
	}
	clone.classList.add("pb-preview-clone");
	clone.style.transform = this.Camera.transform(this.cameraForStep(this.steps[index], PREVIEW_W, PREVIEW_H));
	this.applyState(index, clone);
	frame.appendChild(clone);
	this.previews[index] = frame;
	return frame;
};

/*** Fullscreen ***/

P.enterFullscreen = function() {
	if (this.root.requestFullscreen && !this.doc.fullscreenElement) {
		this.enteredFullscreen = true;
		try {
			var promise = this.root.requestFullscreen();
			promise && promise.catch && promise.catch(function() {});
		} catch (e) {}
	}
};

P.toggleFullscreen = function() {
	if (this.doc.fullscreenElement) {
		// Leaving fullscreen with the button keeps presenting.
		this.togglingFullscreen = true;
		this.enteredFullscreen = false;
		this.doc.exitFullscreen && this.doc.exitFullscreen();
	} else {
		this.enterFullscreen();
	}
};

P.onFullscreenChange = function() {
	var self = this;
	if (this.doc.fullscreenElement === this.root) {
		this.wentFullscreen = true;
	} else if (this.wentFullscreen && this.enteredFullscreen && !this.env.standalone && !this.togglingFullscreen) {
		// Esc in fullscreen ends the presentation the presentation started.
		this.stop();
		return;
	}
	this.togglingFullscreen = false;
	setTimeout(function() { !self.stopped && self.reaim(); }, 60);
};

/*** Input ***/

P.onKey = function(event) {
	var target = event.target;
	if (target && target.closest && target.closest("input, textarea, select, [contenteditable='true']")) {
		return;
	}
	var handled = true;
	switch (event.key) {
	case "ArrowRight":
	case "ArrowDown":
	case "PageDown":
	case " ":
	case "Enter":
		this.next();
		break;
	case "ArrowLeft":
	case "ArrowUp":
	case "PageUp":
	case "Backspace":
		this.prev();
		break;
	case "Home":
		this.goTo(0);
		break;
	case "End":
		this.goTo(this.steps.length - 1);
		break;
	case "o":
	case "O":
		this.showOverview();
		break;
	case "f":
	case "F":
		this.toggleFullscreen();
		break;
	case "p":
	case "P":
		this.setPen(!this.pen.on);
		break;
	case "Escape":
		if (this.pen.on) {
			this.setPen(false);
		} else if (!this.env.standalone) {
			this.stop();
		}
		break;
	default:
		handled = false;
	}
	if (handled) {
		event.preventDefault();
		event.stopPropagation();
	}
};

P.toWorld = function(clientX, clientY) {
	var rect = this.viewport.getBoundingClientRect();
	return this.Camera.toWorld(this.getCamera(), clientX - rect.left, clientY - rect.top);
};

P.onPointerDown = function(event) {
	var target = event.target;
	if (target.closest && target.closest(".pb-chrome")) {
		return;
	}
	this.pointers[event.pointerId] = {x: event.clientX, y: event.clientY};
	var ids = Object.keys(this.pointers);
	if (ids.length === 2) {
		this.cancelInk();
		var a = this.pointers[ids[0]], b = this.pointers[ids[1]];
		this.gesture = {
			kind: "pinch",
			dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
			mid: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2},
			camera: this.getCamera()
		};
		return;
	}
	if (ids.length > 2 || this.gesture || (event.button !== 0 && event.button !== 1)) {
		return;
	}
	var g = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: this.getCamera()};
	if (this.pen.on && event.button === 0) {
		g.kind = "ink";
		this.startInk(g, event);
	} else if (target.closest && target.closest(INTERACTIVE)) {
		return;
	} else {
		g.kind = "pan";
	}
	this.gesture = g;
	if (g.kind === "ink") {
		this.capture(event);
	}
};

P.capture = function(event) {
	try {
		this.viewport.setPointerCapture(event.pointerId);
	} catch (e) {}
	event.cancelable && event.preventDefault();
};

P.onPointerMove = function(event) {
	if (this.pointers[event.pointerId]) {
		this.pointers[event.pointerId] = {x: event.clientX, y: event.clientY};
	}
	var g = this.gesture;
	if (!g) {
		return;
	}
	if (g.kind === "pinch") {
		var ids = Object.keys(this.pointers);
		if (ids.length < 2) {
			return;
		}
		var a = this.pointers[ids[0]], b = this.pointers[ids[1]];
		var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
		var rect = this.viewport.getBoundingClientRect();
		var cam = this.Camera.zoomAt(g.camera, dist / g.dist, g.mid.x - rect.left, g.mid.y - rect.top);
		cam.x += (a.x + b.x) / 2 - g.mid.x;
		cam.y += (a.y + b.y) / 2 - g.mid.y;
		this.stopAnimation();
		this.setCamera(cam);
		return;
	}
	if (event.pointerId !== g.pointerId) {
		return;
	}
	var dx = event.clientX - g.x, dy = event.clientY - g.y;
	if (g.kind === "pan") {
		if (!g.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) {
			return;
		}
		if (!g.moved) {
			g.moved = true;
			this.capture(event);
			this.root.classList.add("pb-panning");
		}
		this.stopAnimation();
		var c = g.camera;
		this.setCamera({x: c.x + dx, y: c.y + dy, s: c.s, r: c.r || 0});
	} else if (g.kind === "ink") {
		this.moveInk(g, event);
	}
};

P.onPointerUp = function(event) {
	delete this.pointers[event.pointerId];
	var g = this.gesture;
	if (!g) {
		return;
	}
	if (g.kind === "pinch") {
		if (Object.keys(this.pointers).length === 0) {
			this.gesture = null;
		}
		return;
	}
	if (event.pointerId !== g.pointerId) {
		return;
	}
	this.gesture = null;
	this.root.classList.remove("pb-panning");
	try {
		this.viewport.releasePointerCapture(event.pointerId);
	} catch (e) {}
	if (g.kind === "ink") {
		this.endInk(g, event);
	}
};

P.onWheel = function(event) {
	if (event.target.closest && event.target.closest(".pb-chrome")) {
		return;
	}
	event.preventDefault();
	var rect = this.viewport.getBoundingClientRect();
	var delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
	var factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015));
	this.stopAnimation();
	this.setCamera(this.Camera.zoomAt(this.getCamera(), factor, event.clientX - rect.left, event.clientY - rect.top));
};

P.stopAnimation = function() {
	if (this.animation) {
		this.win.cancelAnimationFrame(this.animation);
		this.animation = null;
	}
};

/*** Pen: temporary notes on top of the presentation (never saved) ***/

P.buildPenUi = function() {
	var doc = this.doc, self = this;
	var labels = this.env.labels || {};
	this.penButton = button(doc, "pen", labels.pen || "Pen (P)", function() { self.setPen(!self.pen.on); }, "pb-pen-toggle");
	this.penTools = {};
	var tools = el(doc, "div", "pb-pen-tools");
	[["pen", "Pen"], ["highlighter", "Highlighter"], ["text", "Text"], ["eraser", "Eraser"]].forEach(function(t) {
		var b = button(doc, t[0], labels[t[0]] || t[1], function() { self.pen.tool = t[0]; self.renderPen(); });
		self.penTools[t[0]] = b;
		tools.appendChild(b);
	});
	var colors = el(doc, "div", "pb-pen-colors");
	this.penSwatches = PEN_COLORS.map(function(color) {
		var b = el(doc, "button", "pb-swatch", null, function() {
			self.pen.color = color;
			if (self.pen.tool === "eraser") {
				self.pen.tool = "pen";
			}
			self.renderPen();
		});
		b.type = "button";
		b.title = color;
		b.style.setProperty("--pb-swatch", color);
		b.setAttribute("data-color", color);
		colors.appendChild(b);
		return b;
	});
	var size = el(doc, "input", "pb-pen-size");
	size.type = "range";
	size.min = "1";
	size.max = "24";
	size.value = String(this.pen.size);
	size.title = labels.size || "Size";
	size.addEventListener("input", function() { self.pen.size = Number(size.value); });
	var clear = button(doc, "trash", labels.clear || "Clear notes", function() {
		while (self.ink.firstChild) {
			self.ink.removeChild(self.ink.firstChild);
		}
	});
	this.penPanel = el(doc, "div", "pb-pen-panel", [tools, colors, el(doc, "div", "pb-pen-row", [size, clear])]);
	this.penBox = el(doc, "div", "pb-present-pen", [this.penPanel, this.penButton]);
	this.renderPen();
	return this.penBox;
};

P.setPen = function(on) {
	this.pen.on = on;
	this.finishText && this.finishText();
	toggle(this.root, "pb-pen-on", on);
	this.renderPen();
};

P.renderPen = function() {
	var pen = this.pen;
	toggle(this.penBox, "pb-open", pen.on);
	toggle(this.penButton, "pb-active", pen.on);
	for (var tool in this.penTools) {
		toggle(this.penTools[tool], "pb-active", tool === pen.tool);
	}
	this.penSwatches.forEach(function(b) {
		toggle(b, "pb-active", b.getAttribute("data-color") === pen.color && pen.tool !== "eraser");
	});
	this.root.setAttribute("data-pb-pen", pen.tool);
};

P.startInk = function(g, event) {
	var pen = this.pen;
	var p = this.toWorld(event.clientX, event.clientY);
	var s = this.getCamera().s;
	if (pen.tool === "eraser") {
		this.eraseAt(event.clientX, event.clientY);
		return;
	}
	if (pen.tool === "text") {
		g.text = true;
		this.placeText(event.clientX, event.clientY, p);
		return;
	}
	var width = pen.size / s * (pen.tool === "highlighter" ? 4 : 1);
	g.points = [[p.x, p.y]];
	g.path = svg(this.doc, "path", {
		"data-pb-ink": "1",
		fill: "none",
		stroke: pen.color,
		"stroke-width": width,
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		"stroke-opacity": pen.tool === "highlighter" ? "0.38" : "1",
		d: "M" + p.x + " " + p.y + "l0.01 0"
	});
	this.ink.appendChild(g.path);
};

P.moveInk = function(g, event) {
	if (this.pen.tool === "eraser") {
		this.eraseAt(event.clientX, event.clientY);
		return;
	}
	if (!g.path) {
		return;
	}
	var p = this.toWorld(event.clientX, event.clientY);
	g.points.push([p.x, p.y]);
	g.path.setAttribute("d", smooth(g.points));
};

P.endInk = function(g) {
	if (g.path && g.points.length > 1) {
		g.path.setAttribute("d", smooth(g.points));
	}
};

P.cancelInk = function() {
	var g = this.gesture;
	if (g && g.kind === "ink" && g.path) {
		remove(g.path);
	}
	this.gesture = null;
};

P.eraseAt = function(clientX, clientY) {
	var hit = this.doc.elementFromPoint(clientX, clientY);
	var inked = hit && hit.closest && hit.closest("[data-pb-ink]");
	if (inked && this.ink.contains(inked)) {
		remove(inked);
	}
};

P.placeText = function(clientX, clientY, worldPoint) {
	var self = this, doc = this.doc;
	this.finishText && this.finishText();
	var rect = this.root.getBoundingClientRect();
	var fontPx = 14 + this.pen.size * 3;
	var area = el(doc, "textarea", "pb-present-text pb-chrome");
	area.style.left = (clientX - rect.left) + "px";
	area.style.top = (clientY - rect.top - fontPx * 0.7) + "px";
	area.style.fontSize = fontPx + "px";
	area.style.color = this.pen.color;
	area.rows = 1;
	var camera = this.getCamera();
	var color = this.pen.color;
	var done = false;
	this.finishText = function() {
		if (done) {
			return;
		}
		done = true;
		self.finishText = null;
		var value = area.value.replace(/\s+$/, "");
		remove(area);
		if (!value) {
			return;
		}
		var size = fontPx / camera.s;
		var text = svg(doc, "text", {
			"data-pb-ink": "1",
			x: worldPoint.x,
			y: worldPoint.y,
			fill: color,
			"font-size": size,
			"dominant-baseline": "middle",
			"class": "pb-ink-text"
		});
		if (camera.r) {
			// Keep the note upright on screen.
			text.setAttribute("transform", "rotate(" + (-camera.r) + " " + worldPoint.x + " " + worldPoint.y + ")");
		}
		value.split("\n").forEach(function(line, i) {
			var span = svg(doc, "tspan", {x: worldPoint.x, dy: i === 0 ? 0 : size * 1.25});
			span.textContent = line;
			text.appendChild(span);
		});
		self.ink.appendChild(text);
		try {
			self.root.focus({preventScroll: true});
		} catch (e) {}
	};
	area.addEventListener("keydown", function(event) {
		event.stopPropagation();
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			self.finishText && self.finishText();
		} else if (event.key === "Escape") {
			area.value = "";
			self.finishText && self.finishText();
		}
	});
	area.addEventListener("blur", function() { self.finishText && self.finishText(); });
	this.ui.appendChild(area);
	setTimeout(function() { area.focus(); }, 0);
};

/*** Helpers ***/

function smooth(points) {
	var r = function(n) { return Math.round(n * 10) / 10; };
	var d = "M" + r(points[0][0]) + " " + r(points[0][1]);
	for (var i = 1; i < points.length - 1; i++) {
		d += "Q" + r(points[i][0]) + " " + r(points[i][1]) + " " +
			r((points[i][0] + points[i + 1][0]) / 2) + " " + r((points[i][1] + points[i + 1][1]) / 2);
	}
	var last = points[points.length - 1];
	return d + "L" + r(last[0]) + " " + r(last[1]);
}

function el(doc, tag, className, children, onclick) {
	var node = doc.createElement(tag);
	if (className) {
		node.className = className;
	}
	(children || []).forEach(function(child) {
		if (child) {
			node.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
		}
	});
	if (onclick) {
		node.addEventListener("click", onclick);
	}
	return node;
}

function svg(doc, tag, attrs) {
	var node = doc.createElementNS(SVGNS, tag);
	for (var name in attrs || {}) {
		node.setAttribute(name, attrs[name]);
	}
	return node;
}

function button(doc, icon, title, onclick, extraClass) {
	var b = el(doc, "button", "pb-btn" + (extraClass ? " " + extraClass : ""), null, onclick);
	b.type = "button";
	b.title = title;
	b.setAttribute("aria-label", title);
	var icn = svg(doc, "svg", {"class": "pb-icon", viewBox: "0 0 24 24", "aria-hidden": "true"});
	icn.appendChild(svg(doc, "path", {d: ICONS[icon] || ""}));
	b.appendChild(icn);
	return b;
}

function toggle(node, className, on) {
	if (on) {
		node.classList.add(className);
	} else {
		node.classList.remove(className);
	}
}

function remove(node) {
	if (node && node.parentNode) {
		node.parentNode.removeChild(node);
	}
}
