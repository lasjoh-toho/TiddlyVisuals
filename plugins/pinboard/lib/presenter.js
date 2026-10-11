/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/presenter.js
type: application/javascript
module-type: library

Presentation mode and export. Both hand the board to the same player
(player.js): inside the wiki it drives the live board, and exported HTML
files embed the player and camera modules verbatim.

\*/

"use strict";

var Model = require("./model.js");
var Camera = require("./camera.js");
var Player = require("./player.js");

var CAMERA_SOURCE = "$:/plugins/lasjoh-toho/pinboard/lib/camera.js";
var PLAYER_SOURCE = "$:/plugins/lasjoh-toho/pinboard/lib/player.js";

var methods = exports.methods = {};

methods.startPresentation = function(index) {
	var self = this;
	var steps = this.playerSteps();
	if (steps.length === 0) {
		this.toggleSteps(true);
		return;
	}
	if (this.presenting) {
		this.player.goTo(index || 0);
		return;
	}
	this.closeModal();
	this.closeChooser();
	this.closeEffects && this.closeEffects();
	this.textEditor && this.finishTextEdit();
	this.cancelGesture();
	this.presenting = true;
	this.savedCamera = this.camera;
	this.renderSelection();
	this.renderContextBar();
	this.player = Player.create(Camera, {
		document: this.document,
		window: this.window,
		root: this.root,
		viewport: this.viewport,
		world: this.world,
		steps: steps,
		objects: this.playerObjects(),
		overview: this.contentBounds(),
		fullscreen: true,
		getCamera: function() { return self.camera; },
		setCamera: function(camera) { self.setCamera(camera); },
		onStep: function(i) {
			self.presentIndex = i;
			self.stepsOpen && self.renderSteps();
			self.watchStepSize(steps[i], i);
		},
		onStop: function() { self.afterPresentation(); }
	});
	this.player.start(index || 0);
};

/*
A card's presentation version can grow once it is shown (its images only
load then). Measure it again on arrival and whenever an image in it
loads, and let the player re-aim.
*/
methods.watchStepSize = function(step, index) {
	var self = this;
	if (!step || !step.focus || step.focus.charAt(0) !== "c") {
		return;
	}
	var id = step.focus.substr(2);
	var card = this.cards[id];
	if (!card) {
		return;
	}
	var remeasure = function() {
		if (self.player && self.presentIndex === index) {
			self.player.updateStepRect(index, self.presentRect(id));
		}
	};
	setTimeout(remeasure, 60);
	Array.prototype.forEach.call(card.el.querySelectorAll("img"), function(img) {
		if (!img.complete) {
			img.addEventListener("load", remeasure, {once: true});
		}
	});
};

methods.stopPresentation = function() {
	if (this.player) {
		this.player.stop();
	}
};

methods.afterPresentation = function() {
	this.player = null;
	this.presenting = false;
	this.presentIndex = -1;
	if (this.savedCamera && !this.destroyed) {
		this.animateCamera(this.savedCamera, 600);
	}
	if (!this.destroyed) {
		this.updateUi();
		this.renderSelection();
	}
};

/*
Steps whose target still exists, in order.
*/
methods.playableSteps = function() {
	var self = this;
	return this.data.steps.filter(function(step) {
		return !!self.stepTarget(step);
	});
};

/*
What the camera aims at for a step: an upright rectangle plus the angle
it is turned by.
*/
methods.stepTarget = function(step) {
	switch (step.kind) {
	case "frame":
	case "shape":
		var shape = Model.findShape(this.data, step.ref);
		if (!shape) {
			return null;
		}
		if (Model.isBoxType(shape.type)) {
			return {rect: {x: shape.x, y: shape.y, w: shape.w, h: shape.h}, rot: shape.rot || 0};
		}
		return {rect: Model.shapeBounds(shape), rot: 0};
	case "card":
		var rect = this.presenting || this.measuringPresent ? this.presentRect(step.ref) : this.cardRect(step.ref);
		return rect ? {rect: rect, rot: 0} : null;
	case "view":
		return {rect: {x: step.x, y: step.y, w: step.w, h: step.h}, rot: 0};
	}
	return null;
};

methods.playerSteps = function() {
	var self = this;
	this.measuringPresent = true;
	var steps = this.playableSteps().map(function(step) {
		var target = self.stepTarget(step);
		var key = step.kind === "card" ? "c:" + step.ref : (step.kind === "view" ? null : "s:" + step.ref);
		return {
			id: step.id,
			rect: target.rect,
			rot: target.rot,
			padding: self.stepPadding(step),
			title: self.stepTitle(step),
			focus: key,
			occlude: (step.kind === "card" || step.kind === "shape") ? self.coveringShapes(step) : []
		};
	});
	this.measuringPresent = false;
	return steps;
};

/*
Shapes lying on top of a step's card or shape. They are hidden while that
step is shown, so a sticky note can cover something until the
presentation arrives there.
*/
methods.coveringShapes = function(step) {
	var shapes = this.data.shapes;
	var order = function(shape) {
		return (shape.layer === "back" ? 0 : 20000) + shapes.indexOf(shape);
	};
	var targetZ, targetRect;
	if (step.kind === "card") {
		targetZ = 10000;
		targetRect = this.cardRect(step.ref);
	} else {
		var target = Model.findShape(this.data, step.ref);
		targetZ = target ? order(target) : Infinity;
		targetRect = target && Model.shapeBounds(target);
	}
	if (!targetRect) {
		return [];
	}
	var area = Math.max(1, targetRect.w * targetRect.h);
	var out = [];
	shapes.forEach(function(shape) {
		if (shape.hidden || shape.type === "frame" || shape.id === step.ref || order(shape) <= targetZ) {
			return;
		}
		var b = Model.shapeBounds(shape);
		var ix = Math.min(b.x + b.w, targetRect.x + targetRect.w) - Math.max(b.x, targetRect.x);
		var iy = Math.min(b.y + b.h, targetRect.y + targetRect.h) - Math.max(b.y, targetRect.y);
		if (ix > 0 && iy > 0 && ix * iy >= area * 0.25) {
			out.push("s:" + shape.id);
		}
	});
	return out;
};

/*
Objects with build or exit effects, with their step ids turned into
positions in the playable path.
*/
methods.playerObjects = function() {
	var ids = this.playableSteps().map(function(step) { return step.id; });
	var out = [];
	var add = function(key, entry) {
		if (entry && (entry.build || entry.exit)) {
			out.push({
				key: key,
				build: entry.build ? ids.indexOf(entry.build) : -1,
				exit: entry.exit ? ids.indexOf(entry.exit) : -1
			});
		}
	};
	this.data.shapes.forEach(function(shape) { add("s:" + shape.id, shape); });
	for (var id in this.data.cards) {
		if (this.cards[id]) {
			add("c:" + id, this.data.cards[id]);
		}
	}
	return out;
};

/*** Export ***/

/*
Builds a single, self-contained HTML file that plays the presentation
without TiddlyWiki: the rendered board, the page's styles, and the same
player and camera code used here.
*/
methods.exportPresentationHtml = function() {
	var doc = this.document;
	var steps = this.playerSteps();
	this.renderNow();
	var world = this.world.cloneNode(true);
	var strip = world.querySelectorAll(".pb-layer-ui, .pb-layer-ink, .pb-card-tools, .pb-card-resize, .pb-card-connector");
	for (var i = 0; i < strip.length; i++) {
		strip[i].parentNode.removeChild(strip[i]);
	}
	var marked = world.querySelectorAll(".pb-selected, .pb-dragging, .pb-occluded, .pb-spotlight, .pb-build-hidden, .pb-exit-hidden");
	for (i = 0; i < marked.length; i++) {
		["pb-selected", "pb-dragging", "pb-occluded", "pb-spotlight", "pb-build-hidden", "pb-exit-hidden"].forEach(function(c) {
			marked[i].classList.remove(c);
		});
	}
	// Links lead nowhere outside the wiki.
	var links = world.querySelectorAll("a[href^='#']");
	for (i = 0; i < links.length; i++) {
		links[i].removeAttribute("href");
	}
	var styles = Array.prototype.map.call(doc.querySelectorAll("style"), function(style) {
		return style.textContent;
	}).join("\n");
	var title = this.exportTitle();
	var data = {
		title: title,
		steps: steps,
		objects: this.playerObjects(),
		overview: this.contentBounds()
	};
	var rootClass = this.root.className.replace(/\bpb-(presenting|panning|space|pen-on)\b/g, "").trim();
	var rootStyle = this.root.getAttribute("style") || "";
	var script = function(text) {
		return text.replace(/<\/(script)/gi, "<\\/$1");
	};
	var module = function(name, title) {
		return "var " + name + " = {};\n(function(exports) {\n" + script(this.wiki.getTiddlerText(title) || "") + "\n})(" + name + ");\n";
	}.bind(this);
	return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
		"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
		"<title>" + escapeHtml(title) + "</title>\n" +
		"<style>\n" + styles.replace(/<\/(style)/gi, "<\\/$1") + "\n" +
		"html, body { margin: 0; padding: 0; overflow: hidden; height: 100%; }\n</style>\n</head>\n" +
		"<body class=\"" + escapeHtml(doc.body.className) + "\">\n" +
		"<div class=\"" + escapeHtml(rootClass) + " pb-export\" tabindex=\"0\" style=\"" + escapeHtml(rootStyle) + "\">" +
		"<div class=\"pb-viewport\">" + world.outerHTML + "</div></div>\n" +
		"<script>\n" + module("PinboardCamera", CAMERA_SOURCE) + module("PinboardPlayer", PLAYER_SOURCE) +
		"var data = " + script(JSON.stringify(data)) + ";\n" +
		"var root = document.querySelector('.pb-root');\n" +
		"var player = PinboardPlayer.create(PinboardCamera, {document: document, window: window, root: root, " +
		"viewport: root.querySelector('.pb-viewport'), world: root.querySelector('.pb-world'), " +
		"steps: data.steps, objects: data.objects, overview: data.overview, standalone: true, keyTarget: document});\n" +
		"player.start(0);\n</script>\n</body>\n</html>\n";
};

methods.exportTitle = function() {
	var store = this.graph.store || "";
	var title = store.replace(/^\$:\/graph\//, "");
	return title || "Pinboard presentation";
};

methods.downloadPresentation = function() {
	if (this.playableSteps().length === 0) {
		this.toggleSteps(true);
		return;
	}
	var html = this.exportPresentationHtml();
	var doc = this.document, win = this.window;
	var blob = new win.Blob([html], {type: "text/html"});
	var url = win.URL.createObjectURL(blob);
	var link = doc.createElement("a");
	link.href = url;
	link.download = this.exportTitle().replace(/[\\\/:*?"<>|]+/g, "_") + ".html";
	doc.body.appendChild(link);
	link.click();
	doc.body.removeChild(link);
	setTimeout(function() { win.URL.revokeObjectURL(url); }, 5000);
};

function escapeHtml(text) {
	return String(text).replace(/[&<>"]/g, function(c) {
		return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c];
	});
}
