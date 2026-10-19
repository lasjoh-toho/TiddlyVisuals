/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/ui.js
type: application/javascript
module-type: library

The Pinboard's chrome: tool dock, zoom bar, presentation path panel,
context bar for the selection, and the full-height tiddler viewer.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var MODAL_TEMPLATE = "$:/plugins/lasjoh-toho/pinboard/templates/modal";

var COLORS = ["#1f2937", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ffffff"];
var NOTE_COLORS = ["#fde68a", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#fed7aa", "#e9d5ff", "#ffffff"];
// The drawing dock: one narrow column. Each group opens a flyout to the
// side with its tools and their settings. Selecting, panning and zooming
// live in the navigation menu, frames in the presentation menu.
var DOCK_GROUPS = [
	{key: "draw", title: "Draw", options: ["colors", "width"], tools: [
		["pen", "Pencil (P)"],
		["highlighter", "Brush (M)"],
		["curve", "Bezier curve (B): click points, double-click to finish"]]},
	{key: "shapes", title: "Shapes", options: ["colors", "width", "fill"], tools: [
		["ellipse", "Circle / ellipse (O)"],
		["rect", "Rectangle (R)"],
		["polygon", "Polygon (G): click corners, double-click or click the first corner to close"],
		["line", "Line (L)"],
		["arrow", "Arrow (A)"]]},
	{key: "text", title: "Text", options: ["colors", "fontSize"], tools: [
		["text", "Text (T)"]]},
	{key: "notes", title: "Sticky note", options: ["noteColors"], tools: [
		["sticky", "Sticky note (N)"]]}
];
var MIN_SCALE = 0.05, MAX_SCALE = 8;

var methods = exports.methods = {};

methods.buildUi = function() {
	var doc = this.document, self = this;
	var el = function(tag, attrs, children) { return Dom.el(doc, tag, attrs, children); };
	var toolButton = function(name, title) {
		// Clicking the active tool again goes back to selecting.
		var btn = Dom.button(doc, name, title, function() {
			self.setTool(self.tool === name ? "select" : name);
		});
		self.toolButtons[name] = btn;
		return btn;
	};
	this.toolButtons = Object.create(null);
	this.groupButtons = Object.create(null);
	this.groupTool = Object.create(null);

	// Drawing dock (left)
	var dock = el("div", {"class": "pb-toolbar pb-chrome", role: "toolbar", "aria-label": "Drawing tools"});
	DOCK_GROUPS.forEach(function(group) {
		self.groupTool[group.key] = group.tools[0][0];
		var btn = Dom.button(doc, group.tools[0][0], group.title, function() {
			if (self.flyoutGroup === group.key) {
				self.closeFlyout();
			} else {
				self.setTool(self.groupTool[group.key]);
				self.openFlyout(group.key);
			}
		}, group.tools.length > 1 ? "pb-has-flyout" : "");
		self.groupButtons[group.key] = btn;
		dock.appendChild(btn);
	});
	dock.appendChild(el("div", {"class": "pb-dock-sep"}));
	dock.appendChild(toolButton("eraser", "Eraser (E)"));
	dock.appendChild(toolButton("card", "Add tiddler card (C)"));
	dock.appendChild(el("div", {"class": "pb-dock-sep"}));
	this.undoButton = Dom.button(doc, "undo", "Undo (Ctrl+Z)", function() { self.undo(); });
	this.redoButton = Dom.button(doc, "redo", "Redo (Ctrl+Shift+Z)", function() { self.redo(); });
	dock.appendChild(this.undoButton);
	dock.appendChild(this.redoButton);
	this.toolbar = dock;
	this.root.appendChild(dock);
	this.flyout = el("div", {"class": "pb-flyout pb-chrome"});
	this.root.appendChild(this.flyout);

	// Presentation menu (top right)
	this.stepsButton = Dom.button(doc, "steps", "Presentation path", function() { self.toggleSteps(); });
	this.layersButton = Dom.button(doc, "layers", "Layers", function() { self.toggleLayers(); });
	this.presentMenu = el("div", {"class": "pb-topbar pb-chrome", role: "toolbar", "aria-label": "Presentation"}, [
		Dom.button(doc, "play", "Present (from the first step)", function() { self.startPresentation(0); }, "pb-btn-primary"),
		this.stepsButton,
		this.layersButton
	]);
	this.root.appendChild(this.presentMenu);

	// Navigation menu (bottom right)
	this.lupeButton = Dom.button(doc, "search", "Zoom and view", function() { self.togglePopup("lupe"); });
	this.backgroundButton = Dom.button(doc, "palette", "Background", function() { self.togglePopup("background"); });
	this.fullscreenButton = Dom.button(doc, "fullscreen", "Fullscreen", function() { self.toggleFullscreen(); });
	this.zoomLabel = el("span", {"class": "pb-zoom-label"});
	this.navMenu = el("div", {"class": "pb-zoombar pb-chrome", role: "toolbar", "aria-label": "Navigation"}, [
		toolButton("select", "Select and move (V)"),
		toolButton("hand", "Pan (H, or hold Space)"),
		this.lupeButton,
		this.zoomLabel,
		this.backgroundButton,
		this.fullscreenButton
	]);
	this.root.appendChild(this.navMenu);
	this.navPopup = el("div", {"class": "pb-popup pb-nav-popup pb-chrome"});
	this.root.appendChild(this.navPopup);

	// Notice when nothing can be saved
	this.notice = el("div", {"class": "pb-notice pb-chrome", text: "Drawings are not saved: give this graph a “store” property."});
	this.root.appendChild(this.notice);

	// Context bar for the selection
	this.contextBar = el("div", {"class": "pb-context pb-chrome"});
	this.root.appendChild(this.contextBar);

	// Side panels: presentation path and layers
	this.stepsPanel = el("div", {"class": "pb-steps pb-chrome"});
	this.layersPanel = el("div", {"class": "pb-steps pb-layers pb-chrome"});
	this.root.appendChild(this.stepsPanel);
	this.root.appendChild(this.layersPanel);
	this.root.setAttribute("data-pb-tool", this.tool);

	this.onFullscreenChange = function() {
		if (doc.fullscreenElement === doc.documentElement) {
			self.pageFullscreen = true;
		} else if (self.pageFullscreen) {
			// Esc left fullscreen: the board goes back into the page too.
			self.pageFullscreen = false;
			self.fullscreen = false;
		}
		self.applyFullscreen();
	};
	doc.addEventListener("fullscreenchange", this.onFullscreenChange);
};

methods.updateUi = function() {
	if (!this.toolbar) {
		return;
	}
	for (var tool in this.toolButtons) {
		$tw.utils.toggleClass(this.toolButtons[tool], "pb-active", tool === this.tool);
	}
	this.toolButtons.card.style.display = this.can("graph", null, "addNode") ? "" : "none";
	var self = this;
	DOCK_GROUPS.forEach(function(group) {
		var inGroup = group.tools.some(function(t) { return t[0] === self.tool; });
		if (inGroup) {
			self.groupTool[group.key] = self.tool;
		}
		var btn = self.groupButtons[group.key];
		$tw.utils.toggleClass(btn, "pb-active", inGroup);
		var path = btn.querySelector("path");
		var icon = Dom.icon(self.document, self.groupTool[group.key]).querySelector("path").getAttribute("d");
		if (path.getAttribute("d") !== icon) {
			path.setAttribute("d", icon);
		}
	});
	this.syncFlyout();
	this.undoButton.disabled = this.undoStack.length === 0;
	this.redoButton.disabled = this.redoStack.length === 0;
	this.notice.style.display = (!this.graph.store && this.isEditable() &&
		(this.data.shapes.length > 0 || this.data.steps.length > 0)) ? "" : "none";
	$tw.utils.toggleClass(this.stepsButton, "pb-active", !!this.stepsOpen);
	$tw.utils.toggleClass(this.layersButton, "pb-active", !!this.layersOpen);
	$tw.utils.toggleClass(this.lupeButton, "pb-active", this.popup === "lupe");
	$tw.utils.toggleClass(this.backgroundButton, "pb-active", this.popup === "background");
	this.applyBackground();
	this.renderContextBar();
	if (this.stepsOpen) {
		this.renderSteps();
	}
	if (this.layersOpen) {
		this.renderLayers();
	}
	this.updateZoomLabel();
};

methods.updateZoomLabel = function() {
	if (this.zoomLabel) {
		this.zoomLabel.textContent = Math.round(this.camera.s * 100) + "%";
	}
	if (this.zoomSlider && !this.zoomSliding) {
		this.zoomSlider.value = String(scaleToSlider(this.camera.s));
	}
};

/*** Dock flyouts ***/

methods.openFlyout = function(key) {
	this.flyoutGroup = key;
	this.renderFlyout();
	this.updateUi();
};

methods.closeFlyout = function() {
	if (this.flyoutGroup) {
		this.flyoutGroup = null;
		this.flyout.classList.remove("pb-open");
		this.updateUi();
	}
};

methods.renderFlyout = function() {
	var doc = this.document, self = this;
	var group = DOCK_GROUPS.filter(function(g) { return g.key === self.flyoutGroup; })[0];
	var fly = this.flyout;
	Dom.clear(fly);
	this.flyoutRefs = {tools: {}, swatches: [], notes: []};
	if (!group) {
		fly.classList.remove("pb-open");
		return;
	}
	var refs = this.flyoutRefs;
	if (group.tools.length > 1) {
		var tools = Dom.el(doc, "div", {"class": "pb-flyout-row"});
		group.tools.forEach(function(t) {
			var b = Dom.button(doc, t[0], t[1], function() {
				self.groupTool[group.key] = t[0];
				self.setTool(t[0]);
			});
			refs.tools[t[0]] = b;
			tools.appendChild(b);
		});
		fly.appendChild(tools);
	}
	if (group.options.indexOf("colors") >= 0) {
		var colors = Dom.el(doc, "div", {"class": "pb-flyout-row pb-colors"});
		COLORS.forEach(function(color) {
			var b = Dom.el(doc, "button", {"class": "pb-swatch", type: "button", title: color, style: {"--pb-swatch": color},
				onclick: function() { self.applyStyle("stroke", color); }});
			b.setAttribute("data-color", color);
			refs.swatches.push(b);
			colors.appendChild(b);
		});
		refs.custom = Dom.el(doc, "input", {type: "color", "class": "pb-color-input", title: "Custom color", value: "#1f2937",
			onchange: function() { self.applyStyle("stroke", refs.custom.value); }});
		colors.appendChild(refs.custom);
		fly.appendChild(colors);
	}
	if (group.options.indexOf("noteColors") >= 0) {
		var notes = Dom.el(doc, "div", {"class": "pb-flyout-row pb-colors"});
		NOTE_COLORS.forEach(function(color) {
			var b = Dom.el(doc, "button", {"class": "pb-swatch pb-swatch-note", type: "button", title: color, style: {"--pb-swatch": color},
				onclick: function() { self.applyStyle("noteColor", color); }});
			b.setAttribute("data-color", color);
			refs.notes.push(b);
			notes.appendChild(b);
		});
		fly.appendChild(notes);
	}
	var slider = function(key, label, min, max) {
		var input = Dom.el(doc, "input", {type: "range", "class": "pb-size-slider", min: String(min), max: String(max), step: "1", title: label});
		var value = Dom.el(doc, "span", {"class": "pb-size-value"});
		input.addEventListener("input", function() {
			value.textContent = input.value;
			self.applyStyle(key, Number(input.value), true);
		});
		input.addEventListener("change", function() { self.commitStyle(); });
		refs[key] = {input: input, value: value};
		fly.appendChild(Dom.el(doc, "label", {"class": "pb-flyout-row pb-size-row"}, [
			Dom.el(doc, "span", {"class": "pb-size-label", text: label}), input, value]));
	};
	if (group.options.indexOf("width") >= 0) {
		slider("width", "Size", 1, 40);
	}
	if (group.options.indexOf("fontSize") >= 0) {
		slider("fontSize", "Size", 10, 96);
	}
	if (group.options.indexOf("fill") >= 0) {
		refs.fill = Dom.el(doc, "button", {"class": "pb-textbtn pb-fill-toggle", type: "button", text: "Fill",
			onclick: function() {
				var shape = self.selectedShape();
				var current = shape ? shape.fill : self.style.fill;
				self.applyStyle("fill", current && current !== "none" ? "none" : tint(self.style.stroke));
			}});
		fly.appendChild(Dom.el(doc, "div", {"class": "pb-flyout-row"}, [refs.fill]));
	}
	fly.classList.add("pb-open");
	// Next to its button.
	var btn = this.groupButtons[group.key];
	var dockRect = this.toolbar.getBoundingClientRect(), rootRect = this.root.getBoundingClientRect();
	var btnRect = btn.getBoundingClientRect();
	fly.style.left = (dockRect.right - rootRect.left + 8) + "px";
	var top = btnRect.top - rootRect.top - 6;
	fly.style.top = Math.max(8, Math.min(top, rootRect.height - fly.offsetHeight - 8)) + "px";
	this.syncFlyout();
};

/*
Shows the current tool and style (or the selected shape's) in the open
flyout without rebuilding it, so sliders keep working while dragged.
*/
methods.syncFlyout = function() {
	var refs = this.flyoutRefs;
	if (!refs || !this.flyoutGroup) {
		return;
	}
	var self = this;
	var shape = this.selectedShape();
	var stroke = shape ? shape.stroke : this.style.stroke;
	var width = shape && Model.isPointType(shape.type) || (shape && !Model.hasText(shape.type)) ?
		(shape.type === "highlighter" ? shape.width / 5 : shape.width) : this.style.width;
	var fontSize = shape && shape.fontSize ? shape.fontSize : this.style.fontSize;
	var note = shape && shape.type === "sticky" ? shape.fill : this.style.noteColor;
	var fill = shape ? shape.fill : this.style.fill;
	for (var tool in refs.tools) {
		$tw.utils.toggleClass(refs.tools[tool], "pb-active", tool === this.tool);
	}
	refs.swatches.forEach(function(b) {
		$tw.utils.toggleClass(b, "pb-active", b.getAttribute("data-color") === stroke);
	});
	refs.notes.forEach(function(b) {
		$tw.utils.toggleClass(b, "pb-active", b.getAttribute("data-color") === note);
	});
	[["width", width], ["fontSize", fontSize]].forEach(function(pair) {
		var ref = refs[pair[0]];
		if (ref && self.document.activeElement !== ref.input) {
			ref.input.value = String(Math.round(pair[1]));
			ref.value.textContent = String(Math.round(pair[1]));
		}
	});
	if (refs.fill) {
		$tw.utils.toggleClass(refs.fill, "pb-textbtn-primary", !!fill && fill !== "none");
	}
};

/*** Fullscreen ***/

/*
The whole page goes fullscreen and the board covers it, instead of the
board element alone: TiddlyWiki opens its own dialogs (choosing a
tiddler, linking cards) on the page, and they must stay visible.
*/
methods.toggleFullscreen = function() {
	var doc = this.document;
	try {
		if (this.fullscreen || doc.fullscreenElement) {
			this.fullscreen = false;
			var exit = doc.fullscreenElement && doc.exitFullscreen && doc.exitFullscreen();
			exit && exit.catch && exit.catch(function() {});
			this.applyFullscreen();
		} else {
			this.fullscreen = true;
			var html = doc.documentElement;
			var enter = html.requestFullscreen && html.requestFullscreen();
			var self = this;
			// Without fullscreen permission (e.g. in a frame) the board still
			// fills the window.
			enter && enter.catch && enter.catch(function() {});
			this.applyFullscreen();
		}
	} catch (e) {}
	this.root.focus({preventScroll: true});
};

/*
Before showing tiddlers in the story river, the board gives the page back.
*/
methods.leaveFullscreen = function() {
	if (this.fullscreen) {
		this.toggleFullscreen();
	}
};

methods.applyFullscreen = function() {
	$tw.utils.toggleClass(this.root, "pb-fullscreen", !!this.fullscreen);
	$tw.utils.toggleClass(this.fullscreenButton, "pb-active", !!this.fullscreen);
	this.scheduleRender();
};

/*
Where overlays (viewer, lightbox) go: the fullscreen element when the
board itself is fullscreen (presenting), otherwise the page.
*/
methods.overlayHost = function() {
	var doc = this.document;
	var fs = doc.fullscreenElement;
	return fs && fs !== doc.documentElement ? fs : doc.body;
};

/*** Navigation popups: Lupe and background ***/

// The zoom slider is logarithmic: 0..100 maps onto MIN_SCALE..MAX_SCALE.
function scaleToSlider(s) {
	return Math.round(100 * Math.log(s / MIN_SCALE) / Math.log(MAX_SCALE / MIN_SCALE));
}
function sliderToScale(v) {
	return MIN_SCALE * Math.pow(MAX_SCALE / MIN_SCALE, v / 100);
}

methods.togglePopup = function(name) {
	this.popup = this.popup === name ? null : name;
	this.renderPopup();
	this.updateUi();
};

methods.renderPopup = function() {
	var doc = this.document, self = this;
	var popup = this.navPopup;
	Dom.clear(popup);
	this.zoomSlider = null;
	$tw.utils.toggleClass(popup, "pb-open", !!this.popup);
	if (this.popup === "lupe") {
		var slider = Dom.el(doc, "input", {type: "range", min: "0", max: "100", step: "1", "class": "pb-zoom-slider", title: "Zoom"});
		slider.value = String(scaleToSlider(this.camera.s));
		slider.addEventListener("input", function() {
			self.zoomSliding = true;
			self.zoomBy(sliderToScale(Number(slider.value)) / self.camera.s);
			self.zoomSliding = false;
		});
		slider.addEventListener("change", function() { self.rememberView(); });
		this.zoomSlider = slider;
		var hideMedia = Dom.button(doc, "nomedia", "Hide images and media", function() {
			self.hideMedia = !self.hideMedia;
			$tw.utils.toggleClass(self.root, "pb-hide-media", self.hideMedia);
			$tw.utils.toggleClass(hideMedia, "pb-active", self.hideMedia);
			self.scheduleRender();
		}, this.hideMedia ? "pb-active" : "");
		popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row"}, [
			Dom.button(doc, "minus", "Zoom out (-)", function() { self.zoomBy(0.8); self.rememberView(); }),
			slider,
			Dom.button(doc, "plus", "Zoom in (+)", function() { self.zoomBy(1.25); self.rememberView(); })
		]));
		popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row"}, [
			Dom.button(doc, "map", "Show everything (0)", function() { self.fitAll(true); self.rememberView(); }),
			Dom.button(doc, "target", "Show the selection", function() { self.fitSelection(); }),
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "100%", title: "Actual size",
				onclick: function() { self.zoomBy(1 / self.camera.s); self.rememberView(); }}),
			hideMedia
		]));
		// Filter bar: hides what does not match, like mod_pinnwand.
		var filter = Dom.el(doc, "input", {type: "search", "class": "pb-input pb-filter-input",
			placeholder: "Filter: words, or a [filter[expression]]", value: this.filterText || ""});
		var count = Dom.el(doc, "span", {"class": "pb-filter-count"});
		filter.addEventListener("input", function() {
			self.setFilter(filter.value);
			count.textContent = self.filterSummary();
		});
		filter.addEventListener("keydown", function(e) {
			if (e.key === "Enter") {
				self.fitFiltered();
			}
		});
		count.textContent = this.filterSummary();
		popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row"}, [
			filter,
			Dom.button(doc, "close", "Clear the filter", function() {
				filter.value = "";
				self.setFilter("");
				count.textContent = "";
			}, "pb-btn-small")
		]));
		popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row pb-filter-foot"}, [
			count,
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "Show matches",
				onclick: function() { self.fitFiltered(); }})
		]));
		setTimeout(function() { filter.focus(); }, 0);
	} else if (this.popup === "background") {
		this.renderBackgroundPopup(popup);
	}
};

/*** Filter (Lupe) ***/

methods.setFilter = function(text) {
	this.filterText = (text || "").trim();
	this.computeFilter();
	this.applyFilter();
	$tw.utils.toggleClass(this.lupeButton, "pb-filtering", !!this.filterText);
};

/*
Which cards and shapes match the filter text: plain words are searched
(all must occur) in the tiddler's fields or the shape's text; text in
square brackets is a TiddlyWiki filter run selecting the cards.
*/
methods.computeFilter = function() {
	var text = this.filterText;
	this.filterMatch = null;
	if (!text) {
		return;
	}
	var match = {cards: Object.create(null), shapes: Object.create(null)};
	var id;
	if (text.charAt(0) === "[") {
		var titles = [];
		try {
			titles = this.wiki.filterTiddlers(text, this.parentWidget);
		} catch (e) {}
		titles.forEach(function(t) { match.cards[t] = true; });
	} else {
		var words = text.toLowerCase().split(/\s+/);
		var hit = function(haystack) {
			haystack = haystack.toLowerCase();
			return words.every(function(w) { return haystack.indexOf(w) >= 0; });
		};
		for (id in this.cards) {
			var tiddler = this.wiki.getTiddler(id);
			var hay = [id, this.nodes[id] && this.nodes[id].label || ""];
			if (tiddler) {
				for (var f in tiddler.fields) {
					var v = tiddler.fields[f];
					hay.push(Array.isArray(v) ? v.join(" ") : (v instanceof Date ? "" : String(v)));
				}
			}
			if (hit(hay.join("\n"))) {
				match.cards[id] = true;
			}
		}
		this.data.shapes.forEach(function(shape) {
			if (shape.text && hit(shape.text)) {
				match.shapes[shape.id] = true;
			}
		});
	}
	this.filterMatch = match;
};

methods.isFilteredOut = function(kind, id) {
	var m = this.filterMatch;
	return !!m && !(kind === "card" ? m.cards[id] : m.shapes[id]);
};

methods.applyFilter = function() {
	var m = this.filterMatch;
	for (var id in this.cards) {
		$tw.utils.toggleClass(this.cards[id].el, "pb-filtered-out", !!m && !m.cards[id]);
	}
	var self = this;
	this.data.shapes.forEach(function(shape) {
		var el = self.shapeEls && self.shapeEls[shape.id];
		// Only shapes with text take part; drawings stay.
		el && $tw.utils.toggleClass(el, "pb-filtered-out", !!m && !!shape.text && !m.shapes[shape.id]);
	});
	this.renderEdges();
};

methods.filterSummary = function() {
	var m = this.filterMatch;
	if (!m) {
		return "";
	}
	var total = Object.keys(this.cards).length;
	var shown = Object.keys(m.cards).filter(function(id) { return this.cards[id]; }, this).length;
	var notes = Object.keys(m.shapes).length;
	return shown + " of " + total + " cards" + (notes ? ", " + notes + " notes" : "");
};

methods.fitFiltered = function() {
	var m = this.filterMatch;
	if (!m) {
		return;
	}
	var rects = [];
	for (var id in m.cards) {
		var r = this.cardRect(id);
		r && rects.push(r);
	}
	var self = this;
	this.data.shapes.forEach(function(shape) {
		if (m.shapes[shape.id]) {
			rects.push(Model.shapeBounds(shape));
		}
	});
	var bounds = Model.unionRects(rects);
	bounds && this.flyTo(bounds, 0.1);
};

methods.fitSelection = function() {
	var sel = this.selection, rect = null;
	if (sel && sel.type === "shape") {
		var shape = this.selectedShape();
		rect = shape && Model.shapeBounds(shape);
	} else if (sel && sel.type === "card") {
		rect = this.cardRect(sel.id);
	}
	if (rect) {
		this.flyTo(rect, 0.15);
	} else {
		this.fitAll(true);
	}
	this.rememberView();
};

var BACKGROUND_COLORS = ["", "#ffffff", "#f5f1e8", "#eef2f7", "#e8f3ec", "#2b2d33", "#14161a"];
var PATTERNS = [["none", "None"], ["dots", "Dots"], ["grid", "Grid"], ["lines", "Lines"]];

methods.boardBackground = function() {
	var bg = this.data.background || {};
	return {
		color: bg.color || this.graph.background || "",
		pattern: bg.pattern || (this.graph.grid === false ? "none" : "dots"),
		image: bg.image || "",
		// "view": the picture stays put behind the board; "board": it is
		// part of the board, centered on its origin, and moves and zooms.
		imageMode: bg.imageMode === "board" ? "board" : "view",
		imageScale: bg.imageScale || 100
	};
};

methods.setBackground = function(key, value) {
	this.checkpoint();
	var bg = this.data.background = this.data.background || {};
	if (value) {
		bg[key] = value;
	} else {
		delete bg[key];
	}
	this.commit();
	this.renderPopup();
};

methods.renderBackgroundPopup = function(popup) {
	var doc = this.document, self = this;
	var bg = this.boardBackground();
	var swatches = BACKGROUND_COLORS.map(function(color) {
		var b = Dom.el(doc, "button", {"class": "pb-swatch pb-swatch-big" + (color === (self.data.background || {}).color || (!color && !(self.data.background || {}).color) ? " pb-active" : ""),
			type: "button", title: color || "Theme default", style: {"--pb-swatch": color || "transparent"},
			onclick: function() { self.setBackground("color", color); }});
		if (!color) {
			b.classList.add("pb-swatch-auto");
		}
		return b;
	});
	var custom = Dom.el(doc, "input", {type: "color", "class": "pb-color-input", title: "Custom color",
		value: /^#[0-9a-f]{6}$/i.test(bg.color) ? bg.color : "#ffffff",
		onchange: function() { self.setBackground("color", custom.value); }});
	swatches.push(custom);
	var patterns = PATTERNS.map(function(p) {
		return Dom.el(doc, "button", {"class": "pb-textbtn" + (bg.pattern === p[0] ? " pb-textbtn-primary" : ""), type: "button", text: p[1],
			onclick: function() { self.setBackground("pattern", p[0]); }});
	});
	var image = Dom.el(doc, "input", {type: "text", "class": "pb-input", placeholder: "Image tiddler or URL", value: bg.image});
	image.addEventListener("change", function() {
		var value = image.value.trim();
		if (value !== bg.image) {
			// Rebuild the popup after this event, not while the field is
			// still being blurred.
			setTimeout(function() { self.setBackground("image", value); }, 0);
		}
	});
	image.addEventListener("keydown", function(e) {
		if (e.key === "Enter") {
			image.blur();
		}
	});
	popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-head"}, [Dom.el(doc, "strong", {text: "Background"})]));
	popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row pb-wrap"}, swatches));
	popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-label", text: "Pattern"}));
	popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row pb-wrap"}, patterns));
	popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-label", text: "Picture"}));
	popup.appendChild(image);
	if (bg.image) {
		var modeButton = function(mode, label, title) {
			return Dom.el(doc, "button", {"class": "pb-textbtn" + (bg.imageMode === mode ? " pb-textbtn-primary" : ""), type: "button", text: label, title: title,
				onclick: function() { self.setBackground("imageMode", mode === "view" ? "" : mode); }});
		};
		popup.appendChild(Dom.el(doc, "div", {"class": "pb-popup-row pb-wrap"}, [
			modeButton("view", "Fixed to the view", "The picture fills the view and stays put while you move around"),
			modeButton("board", "On the board", "The picture lies on the board and moves and zooms with it")
		]));
		if (bg.imageMode === "board") {
			var scale = Dom.el(doc, "input", {type: "range", "class": "pb-size-slider", min: "5", max: "400", step: "5", value: String(bg.imageScale), title: "Picture size"});
			var scaleValue = Dom.el(doc, "span", {"class": "pb-size-value", text: bg.imageScale + "%"});
			scale.addEventListener("input", function() {
				scaleValue.textContent = scale.value + "%";
				(self.data.background = self.data.background || {}).imageScale = Number(scale.value);
				self.backgroundKey = null;
				self.applyBackground();
			});
			scale.addEventListener("change", function() { self.setBackground("imageScale", Number(scale.value)); });
			popup.appendChild(Dom.el(doc, "label", {"class": "pb-popup-row pb-size-row"}, [
				Dom.el(doc, "span", {"class": "pb-size-label", text: "Size"}), scale, scaleValue]));
		}
	}
};

/*
Color, pattern and picture of the board, from the board's own settings or
the graph's properties.
*/
methods.applyBackground = function() {
	var bg = this.boardBackground();
	var key = JSON.stringify(bg);
	if (key === this.backgroundKey) {
		return;
	}
	this.backgroundKey = key;
	this.root.style.setProperty("--pb-bg", bg.color || "");
	$tw.utils.toggleClass(this.root, "pb-has-bg", !!bg.color);
	var self = this;
	["dots", "grid", "lines"].forEach(function(p) {
		$tw.utils.toggleClass(self.root, "pb-pattern-" + p, bg.pattern === p);
	});
	$tw.utils.toggleClass(this.root, "pb-grid", bg.pattern !== "none");
	var url = bg.image ? this.imageUrl(bg.image) : "";
	var onBoard = !!url && bg.imageMode === "board";
	this.root.style.backgroundImage = url && !onBoard ? "url(\"" + url.replace(/"/g, "%22") + "\")" : "";
	$tw.utils.toggleClass(this.root, "pb-has-image", !!url);
	if (onBoard) {
		if (!this.boardImage) {
			this.boardImage = Dom.el(this.document, "img", {"class": "pb-board-image", alt: "", draggable: "false"});
			this.world.insertBefore(this.boardImage, this.world.firstChild);
			this.boardImage.addEventListener("load", function() { self.placeBoardImage(); });
		}
		this.boardImageScale = bg.imageScale / 100;
		if (this.boardImage.getAttribute("src") !== url) {
			this.boardImage.setAttribute("src", url);
		}
		this.placeBoardImage();
	} else if (this.boardImage) {
		Dom.remove(this.boardImage);
		this.boardImage = null;
	}
};

methods.placeBoardImage = function() {
	var img = this.boardImage;
	if (img && img.naturalWidth) {
		var w = img.naturalWidth * this.boardImageScale, h = img.naturalHeight * this.boardImageScale;
		img.style.width = w + "px";
		img.style.left = (-w / 2) + "px";
		img.style.top = (-h / 2) + "px";
	}
};

/*
URL for an image given as tiddler title or as a plain URL.
*/
methods.imageUrl = function(source) {
	var tiddler = this.wiki.getTiddler(source);
	if (!tiddler) {
		return /^(https?:|data:|\.{0,2}\/)/i.test(source) || /\.(png|jpe?g|gif|svg|webp)$/i.test(source) ? source : "";
	}
	if (tiddler.fields._canonical_uri) {
		return tiddler.fields._canonical_uri;
	}
	var type = tiddler.fields.type || "";
	var info = $tw.config.contentTypeInfo[type];
	if (!info || type.indexOf("image/") !== 0) {
		return "";
	}
	var text = tiddler.fields.text || "";
	return info.encoding === "base64" ?
		"data:" + type + ";base64," + text :
		"data:" + type + "," + encodeURIComponent(text);
};

/*** Context bar ***/

methods.renderContextBar = function() {
	var doc = this.document, self = this;
	var bar = this.contextBar;
	Dom.clear(bar);
	var sel = this.selection;
	if (!sel || this.presenting || sel.type !== "shape") {
		bar.style.display = "none";
		return;
	}
	var buttons = [];
	if (sel.type === "shape") {
		var shape = this.selectedShape();
		if (!shape || !this.isEditable()) {
			bar.style.display = "none";
			return;
		}
		if (Model.hasText(shape.type)) {
			buttons.push(Dom.button(doc, "text", shape.type === "frame" ? "Frame title" : "Edit text", function() { self.editShapeText(shape); }));
		}
		if (shape.layer === "back") {
			buttons.push(Dom.button(doc, "front", "Bring above cards", function() { self.setShapeLayer("front"); }));
		} else {
			buttons.push(Dom.button(doc, "back", "Send behind cards", function() { self.setShapeLayer("back"); }));
		}
		buttons.push(Dom.button(doc, "addstep", "Add to presentation path", function() {
			self.addStep({kind: shape.type === "frame" ? "frame" : "shape", ref: shape.id});
		}));
		if (shape.type !== "frame") {
			buttons.push(Dom.button(doc, "eye", "Appear / disappear during the presentation", function() {
				self.openEffects("s:" + shape.id);
			}, shape.build || shape.exit ? "pb-active" : ""));
		}
		if (shape.type === "sticky") {
			buttons.push(Dom.button(doc, "tiddler", "Turn into a tiddler", function() { self.turnIntoTiddler(shape); }));
		} else {
			buttons.push(Dom.button(doc, "plus", "Duplicate (Ctrl+D)", function() { self.duplicateSelection(); }));
		}
		buttons.push(Dom.button(doc, "trash", "Delete (Del)", function() { self.deleteSelection(); }));
	} else {
		// Cards carry their own tools.
		bar.style.display = "none";
		return;
	}
	buttons.forEach(function(b) { bar.appendChild(b); });
	bar.style.display = "";
	this.positionContextBar();
};

methods.positionContextBar = function() {
	var bar = this.contextBar;
	if (!bar || bar.style.display === "none" || !this.selection) {
		return;
	}
	var sel = this.selection, rect = null;
	if (sel.type === "shape") {
		var shape = this.selectedShape();
		rect = shape && Model.shapeBounds(shape);
	}
	if (!rect) {
		bar.style.display = "none";
		return;
	}
	var p = this.toScreen(rect.x + rect.w / 2, rect.y);
	var size = this.viewSize();
	var width = bar.offsetWidth || 160;
	// Leave room for the rotate handle above box shapes.
	var shapeAbove = sel.type === "shape" && Model.isBoxType((this.selectedShape() || {}).type);
	var top = p.y - 48 - (shapeAbove ? 40 : 0);
	if (top < 8) {
		top = this.toScreen(0, rect.y + rect.h).y + 12;
	}
	bar.style.left = Math.min(Math.max(8, p.x - width / 2), size.w - width - 8) + "px";
	bar.style.top = Math.min(Math.max(8, top), size.h - 48) + "px";
};

/*** Presentation path ***/

methods.toggleSteps = function(open) {
	this.stepsOpen = open === undefined ? !this.stepsOpen : open;
	if (this.stepsOpen) {
		this.layersOpen = false;
	}
	$tw.utils.toggleClass(this.stepsPanel, "pb-open", this.stepsOpen);
	$tw.utils.toggleClass(this.layersPanel, "pb-open", !!this.layersOpen);
	this.updateUi();
	this.scheduleRender();
};

methods.toggleLayers = function(open) {
	this.layersOpen = open === undefined ? !this.layersOpen : open;
	if (this.layersOpen) {
		this.stepsOpen = false;
	}
	$tw.utils.toggleClass(this.layersPanel, "pb-open", this.layersOpen);
	$tw.utils.toggleClass(this.stepsPanel, "pb-open", !!this.stepsOpen);
	this.updateUi();
	this.scheduleRender();
};

/*
Lets the rows of `list` be reordered by dragging their grip (mouse, pen
or touch). `onMove(from, to)` is called with row indexes once dropped.
*/
methods.makeSortable = function(list, onMove) {
	var self = this, doc = this.document;
	var rows = Array.prototype.slice.call(list.children);
	rows.forEach(function(row, from) {
		var grip = row.querySelector(".pb-grip");
		if (!grip) {
			return;
		}
		grip.addEventListener("pointerdown", function(event) {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			try {
				grip.setPointerCapture(event.pointerId);
			} catch (e) {}
			row.classList.add("pb-sorting");
			var to = from;
			var marker = Dom.el(doc, "li", {"class": "pb-drop-marker"});
			var move = function(e) {
				var y = e.clientY;
				to = rows.length;
				for (var i = 0; i < rows.length; i++) {
					var r = rows[i].getBoundingClientRect();
					if (y < r.top + r.height / 2) {
						to = i;
						break;
					}
				}
				list.insertBefore(marker, rows[to] || null);
			};
			var up = function(e) {
				grip.removeEventListener("pointermove", move);
				grip.removeEventListener("pointerup", up);
				grip.removeEventListener("pointercancel", up);
				row.classList.remove("pb-sorting");
				Dom.remove(marker);
				// Dropping below itself shifts the target by one.
				var target = to > from ? to - 1 : to;
				if (e.type === "pointerup" && target !== from) {
					onMove(from, target);
				}
			};
			grip.addEventListener("pointermove", move);
			grip.addEventListener("pointerup", up);
			grip.addEventListener("pointercancel", up);
		});
	});
};

/*** Layers ***/

methods.shapeName = function(shape) {
	if (shape.text) {
		return shape.text.split("\n")[0];
	}
	return {
		pen: "Drawing", highlighter: "Highlight", rect: "Rectangle", ellipse: "Ellipse",
		line: "Line", arrow: "Arrow", text: "Text", sticky: "Sticky note", frame: "Frame"
	}[shape.type] || shape.type;
};

/*
The layers from top to bottom: shapes above the cards, the cards, shapes
behind them. Dragging a shape past the cards moves it to the other side.
*/
methods.renderLayers = function() {
	var doc = this.document, self = this;
	var panel = this.layersPanel;
	var editable = this.isEditable();
	Dom.clear(panel);
	panel.appendChild(Dom.el(doc, "div", {"class": "pb-popup-head"}, [
		Dom.el(doc, "strong", {text: "Layers"}),
		Dom.button(doc, "close", "Close", function() { self.toggleLayers(false); }, "pb-btn-small")
	]));
	var shapes = this.data.shapes;
	var front = shapes.filter(function(s) { return s.layer !== "back"; }).reverse();
	var back = shapes.filter(function(s) { return s.layer === "back"; }).reverse();
	var entries = front.concat(["cards"], back);
	var list = Dom.el(doc, "ol", {"class": "pb-step-list pb-layer-list"});
	entries.forEach(function(entry) {
		if (entry === "cards") {
			list.appendChild(Dom.el(doc, "li", {"class": "pb-layer-cards"}, [
				Dom.icon(doc, "card"),
				Dom.el(doc, "span", {text: "Cards (" + Object.keys(self.cards).length + ")"})
			]));
			return;
		}
		var shape = entry;
		var selected = self.selection && self.selection.type === "shape" && self.selection.id === shape.id;
		list.appendChild(Dom.el(doc, "li", {"class": "pb-step pb-layer" + (selected ? " pb-current" : "") + (shape.hidden ? " pb-missing" : "")}, [
			editable ? Dom.el(doc, "span", {"class": "pb-grip", title: "Drag to reorder"}, [Dom.icon(doc, "grip")]) : null,
			Dom.el(doc, "button", {"class": "pb-step-name", type: "button", title: "Select",
				onclick: function() {
					if (!shape.hidden) {
						self.select({type: "shape", id: shape.id});
						self.flyTo(Model.shapeBounds(shape), 0.2);
					}
				}}, [
				Dom.el(doc, "span", {"class": "pb-layer-swatch", style: {"--pb-swatch": shape.type === "sticky" ? shape.fill : shape.stroke}}),
				Dom.el(doc, "span", {"class": "pb-step-title", text: self.shapeName(shape)})
			]),
			editable ? Dom.button(doc, shape.hidden ? "hide" : "eye", shape.hidden ? "Show" : "Hide", function() {
				self.checkpoint();
				if (shape.hidden) {
					delete shape.hidden;
				} else {
					shape.hidden = true;
					if (self.selection && self.selection.id === shape.id) {
						self.selection = null;
					}
				}
				self.commit();
			}, "pb-btn-small") : null,
			editable ? Dom.button(doc, "trash", "Delete", function() {
				self.checkpoint();
				Model.removeShape(self.data, shape.id);
				self.commit();
			}, "pb-btn-small") : null
		]));
	});
	if (shapes.length === 0) {
		panel.appendChild(Dom.el(doc, "p", {"class": "pb-empty", text: "Drawings, shapes, notes and frames appear here, the topmost first."}));
	}
	panel.appendChild(list);
	if (editable) {
		this.makeSortable(list, function(from, to) {
			var order = entries.slice();
			var moved = order.splice(from, 1)[0];
			order.splice(to, 0, moved);
			var divider = order.indexOf("cards");
			self.checkpoint();
			order.forEach(function(entry, i) {
				if (entry !== "cards") {
					entry.layer = i < divider ? "front" : "back";
				}
			});
			// Stored bottom to top.
			self.data.shapes = order.filter(function(e) { return e !== "cards"; }).reverse();
			self.commit();
		});
	}
};

methods.addStep = function(step) {
	if (!this.isEditable()) {
		return;
	}
	this.checkpoint();
	step.id = Model.newId("t");
	this.data.steps.push(step);
	this.commit();
	this.toggleSteps(true);
};

methods.stepTitle = function(step) {
	if (step.title) {
		return step.title;
	}
	switch (step.kind) {
	case "frame":
	case "shape":
		var shape = Model.findShape(this.data, step.ref);
		if (!shape) {
			return "(missing)";
		}
		return shape.text ? shape.text.split("\n")[0] : (step.kind === "frame" ? "Frame" : capitalize(shape.type));
	case "card":
		var node = this.nodes[step.ref];
		return node ? (node.label || step.ref) : step.ref + " (not on board)";
	case "view":
		return "Saved view";
	}
	return step.kind;
};

methods.stepPadding = function(step) {
	return step.kind === "frame" || step.kind === "view" ? 0.01 : 0.1;
};

methods.renderSteps = function() {
	var doc = this.document, self = this;
	var panel = this.stepsPanel;
	var editable = this.isEditable();
	Dom.clear(panel);
	this.renderStoryHead(panel);
	var steps = this.data.steps;
	var outline = this.storyOutline();
	var list = Dom.el(doc, "ol", {"class": "pb-step-list"});
	steps.forEach(function(step, index) {
		var missing = !self.stepTarget(step);
		list.appendChild(Dom.el(doc, "li", {"class": "pb-step" + (missing ? " pb-missing" : "") + (self.presenting && self.presentIndex === index ? " pb-current" : ""),
			style: {"--pb-level": String(outline[index].level)}}, [
			editable ? Dom.el(doc, "span", {"class": "pb-grip", title: "Drag to reorder"}, [Dom.icon(doc, "grip")]) : null,
			Dom.el(doc, "button", {"class": "pb-step-name", type: "button", title: editable ? "Show this step (Tab / Shift+Tab: indent / outdent)" : "Show this step",
				onclick: function() {
					var target = self.stepTarget(step);
					target && self.flyTo(target.rect, self.stepPadding(step), true, target.rot);
				},
				onkeydown: function(event) {
					if (editable && event.key === "Tab") {
						event.preventDefault();
						self.indentStep(index, event.shiftKey ? -1 : 1);
						var again = self.stepsPanel.querySelectorAll(".pb-step-name")[index];
						again && again.focus();
					}
				}}, [
				Dom.el(doc, "span", {"class": "pb-step-kind pb-step-kind-" + step.kind, text: String(index + 1)}),
				Dom.el(doc, "span", {"class": "pb-step-title", text: self.stepTitle(step)})
			]),
			editable ? Dom.button(doc, "left", "Outdent", function() { self.indentStep(index, -1); }, "pb-btn-small pb-step-outdent") : null,
			editable ? Dom.button(doc, "right", "Indent (a sub-point of the stop above)", function() { self.indentStep(index, 1); }, "pb-btn-small pb-step-indent") : null,
			Dom.button(doc, "play", "Present from here", function() { self.startPresentation(index); }, "pb-btn-small"),
			editable ? Dom.button(doc, "close", "Remove from path", function() {
				self.checkpoint();
				steps.splice(index, 1);
				self.commit();
			}, "pb-btn-small") : null
		]));
	});
	if (steps.length === 0) {
		panel.appendChild(Dom.el(doc, "p", {"class": "pb-empty",
			text: "Draw frames with the frame tool, or add cards, shapes and views. Each one becomes a stop of the presentation."}));
	}
	panel.appendChild(list);
	if (editable) {
		this.makeSortable(list, function(from, to) {
			self.checkpoint();
			var item = steps.splice(from, 1)[0];
			steps.splice(to, 0, item);
			self.commit();
		});
		panel.appendChild(Dom.el(doc, "div", {"class": "pb-popup-foot"}, [
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "+ Current view",
				onclick: function() {
					var size = self.viewSize();
					var v = Model.viewRect(self.camera, size.w, size.h);
					self.addStep({kind: "view", x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h)});
				}}),
			Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-icon" + (self.tool === "frame" ? " pb-textbtn-primary" : ""), type: "button",
				title: "Presentation frame (F): drag a rectangle; each frame becomes a stop",
				onclick: function() { self.setTool(self.tool === "frame" ? "select" : "frame"); }}, [Dom.icon(doc, "frame"), "Frame"])
		]));
	}
	if (steps.length > 0) {
		panel.appendChild(Dom.el(doc, "div", {"class": "pb-popup-foot"}, [
			Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-primary", type: "button", text: "\u25b6 Present",
				onclick: function() { self.startPresentation(0); }}),
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "Export as HTML",
				title: "Download a self-contained HTML file that plays this presentation anywhere",
				onclick: function() { self.downloadPresentation(); }})
		]));
	}
};

function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.substr(1);
}

function tint(color) {
	var rgb = Model.parseColor(color);
	if (!rgb) {
		return "#e5e7eb";
	}
	// Mix 30% of the color with white.
	return "#" + rgb.map(function(c) {
		var v = Math.round(255 - (255 - c) * 0.3);
		return (v < 16 ? "0" : "") + v.toString(16);
	}).join("");
}

/*** Tiddler viewer ***/

methods.openModal = function(title) {
	var doc = this.document, self = this;
	this.closeModal();
	var host = this.overlayHost();
	var modal = {title: title, editing: false};
	modal.content = Dom.el(doc, "div", {"class": "pb-modal-content"});
	modal.editButton = Dom.el(doc, "button", {"class": "pb-modal-btn", type: "button", title: "Edit this tiddler",
		onclick: function() { self.setModalEditing(!modal.editing); }}, [Dom.icon(doc, "edit"), Dom.el(doc, "span", {text: "Edit"})]);
	modal.controls = Dom.el(doc, "div", {"class": "pb-modal-controls"}, [
		modal.editButton,
		Dom.el(doc, "button", {"class": "pb-modal-btn", type: "button", title: "Open in story river",
			onclick: function() { var t = modal.title; self.closeModal(); self.navigate(t); }}, [Dom.icon(doc, "open")]),
		Dom.el(doc, "button", {"class": "pb-modal-btn pb-modal-close", type: "button", title: "Close (Esc)",
			onclick: function() { self.closeModal(); }}, [Dom.icon(doc, "close"), Dom.el(doc, "span", {text: "Close"})])
	]);
	modal.sheet = Dom.el(doc, "div", {"class": "pb-modal-sheet", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1"}, [
		modal.controls, modal.content
	]);
	modal.el = Dom.el(doc, "div", {"class": "pb-modal"}, [modal.sheet]);
	modal.el.addEventListener("click", function(event) {
		if (event.target === modal.el) {
			self.closeModal();
		} else if (event.target.tagName === "IMG" && !modal.editing && !Dom.closest(event.target, "a", modal.content)
			&& modal.content.contains(event.target)) {
			self.openLightbox(event.target.currentSrc || event.target.src, event.target.alt);
		}
	});
	modal.el.addEventListener("keydown", function(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			if (modal.editing) {
				self.setModalEditing(false);
			} else {
				self.closeModal();
			}
		}
	});
	this.modal = modal;
	host.appendChild(modal.el);
	this.renderModal();
	modal.sheet.focus({preventScroll: true});
};

/*
Links inside the viewer open their target in the viewer instead of the
story river, so reading stays on the board.
*/
methods.modalParentWidget = function() {
	var self = this;
	var parent = Object.create(this.parentWidget);
	parent.dispatchEvent = function(event) {
		if (event.type === "tm-navigate" && event.navigateTo && self.modal) {
			self.openModal(event.navigateTo);
			return false;
		}
		if (event.type === "tm-edit-tiddler" && self.modal) {
			self.setModalEditing(true);
			return false;
		}
		if (event.type === "tm-close-tiddler" && self.modal) {
			self.closeModal();
			return false;
		}
		return self.parentWidget.dispatchEvent(event);
	};
	return parent;
};

methods.renderModal = function() {
	var modal = this.modal;
	if (!modal) {
		return;
	}
	Dom.clear(modal.content);
	modal.textBefore = this.wiki.getTiddlerText(modal.title);
	modal.widget = this.wiki.makeTranscludeWidget(MODAL_TEMPLATE, {
		document: this.document,
		parentWidget: this.modalParentWidget(),
		importPageMacros: true,
		mode: "block",
		variables: {
			currentTiddler: modal.title,
			"pinboard-editing": modal.editing ? "yes" : "no"
		}
	});
	modal.widget.render(modal.content, null);
	$tw.utils.toggleClass(modal.el, "pb-modal-editing", modal.editing);
	modal.editButton.lastChild.textContent = modal.editing ? "Done" : "Edit";
	modal.editButton.title = modal.editing ? "Finish editing" : "Edit this tiddler";
};

methods.setModalEditing = function(editing) {
	var modal = this.modal;
	if (!modal || modal.editing === editing) {
		return;
	}
	if (!editing) {
		this.touchModalTiddler();
	}
	modal.editing = editing;
	this.renderModal();
	if (editing) {
		var area = modal.content.querySelector("textarea, input");
		area && area.focus();
	}
};

/*
Editing in the viewer writes straight to the tiddler; once done, stamp it
as modified like the regular editor would.
*/
methods.touchModalTiddler = function() {
	var modal = this.modal;
	if (!modal || !modal.editing) {
		return;
	}
	var tiddler = this.wiki.getTiddler(modal.title);
	if (tiddler && tiddler.fields.text !== modal.textBefore) {
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, this.wiki.getModificationFields()));
	}
};

methods.refreshModal = function(changes) {
	if (this.modal && this.modal.widget) {
		this.modal.widget.refresh(changes);
	}
};

methods.closeModal = function() {
	var modal = this.modal;
	if (modal) {
		this.touchModalTiddler();
		this.modal = null;
		Dom.remove(modal.el);
		if (!this.destroyed) {
			this.root.focus({preventScroll: true});
		}
	}
};

/*** Build and exit effects ***/

methods.effectsEntry = function(key, create) {
	var id = key.substr(2);
	if (key.charAt(0) === "s") {
		return Model.findShape(this.data, id);
	}
	if (!this.data.cards[id] && create) {
		this.data.cards[id] = {};
	}
	return this.data.cards[id] || null;
};

methods.openEffects = function(key) {
	this.closeChooser();
	this.closeEffects();
	this.effects = {key: key, el: Dom.el(this.document, "div", {"class": "pb-popup pb-effects pb-chrome"})};
	this.root.appendChild(this.effects.el);
	this.renderEffects();
	this.positionPopups();
};

methods.closeEffects = function() {
	if (this.effects) {
		Dom.remove(this.effects.el);
		this.effects = null;
	}
};

methods.renderEffects = function() {
	var self = this, doc = this.document;
	var key = this.effects.key;
	var entry = this.effectsEntry(key, false) || {};
	var steps = this.data.steps;
	var el = this.effects.el;
	var select = function(field, noneLabel) {
		var sel = Dom.el(doc, "select", {"class": "pb-select"});
		sel.appendChild(Dom.el(doc, "option", {value: "", text: noneLabel}));
		steps.forEach(function(step, i) {
			sel.appendChild(Dom.el(doc, "option", {value: step.id, text: (i + 1) + " \u00b7 " + self.stepTitle(step)}));
		});
		sel.value = entry[field] && steps.some(function(s) { return s.id === entry[field]; }) ? entry[field] : "";
		sel.addEventListener("change", function() {
			self.checkpoint();
			var target = self.effectsEntry(key, true);
			if (sel.value) {
				target[field] = sel.value;
			} else {
				delete target[field];
			}
			self.commit();
			self.renderEffects();
		});
		return sel;
	};
	Dom.clear(el);
	el.appendChild(Dom.el(doc, "div", {"class": "pb-popup-head"}, [
		Dom.el(doc, "strong", {text: "During the presentation"}),
		Dom.button(doc, "close", "Close", function() { self.closeEffects(); }, "pb-btn-small")
	]));
	if (steps.length === 0) {
		el.appendChild(Dom.el(doc, "p", {"class": "pb-empty", text: "Add stops to the presentation path first."}));
		return;
	}
	el.appendChild(Dom.el(doc, "label", {"class": "pb-field-row"}, ["Appears at", select("build", "From the start")]));
	el.appendChild(Dom.el(doc, "label", {"class": "pb-field-row"}, ["Disappears at", select("exit", "Never")]));
	el.appendChild(Dom.el(doc, "p", {"class": "pb-empty",
		text: "Shapes lying on top of a card or shape also vanish while the presentation shows what they cover."}));
};

/*** Sticky note -> tiddler ***/

/*
Makes a tiddler from a sticky note (first line = title, the rest = text,
note color = tiddler color) and puts it on the board where the note was.
*/
methods.turnIntoTiddler = function(shape) {
	var text = (shape.text || "").replace(/\r/g, "");
	var lines = text.split("\n");
	var base = (lines[0] || "").trim().substr(0, 80).replace(/[\[\]{}|]/g, "") || "Note";
	var title = this.wiki.generateNewTitle(base);
	var body = lines.slice(1).join("\n").trim();
	var fields = {title: title, text: body};
	if (shape.fill && shape.fill !== "none") {
		fields.color = shape.fill;
	}
	this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getCreationFields(), fields, this.wiki.getModificationFields()));
	var center = {x: shape.x + shape.w / 2, y: shape.y + shape.h / 2};
	this.checkpoint();
	Model.removeShape(this.data, shape.id);
	this.selection = null;
	this.commit();
	if (this.can("graph", null, "drop")) {
		// The graph adds dropped tiddlers to the board; place it where the note was.
		this.pendingPosition = {x: Model.round(center.x), y: Model.round(center.y), time: Date.now(), title: title};
		this.fire("graph", null, "drop", null, {dropTiddler: title});
	} else {
		this.openModal(title);
	}
};

/*** Image lightbox ***/

methods.openLightbox = function(src, alt) {
	var doc = this.document, self = this;
	this.closeLightbox();
	var host = this.overlayHost();
	var img = Dom.el(doc, "img", {src: src, alt: alt || "", draggable: "false"});
	var stage = Dom.el(doc, "div", {"class": "pb-lightbox-stage"}, [img]);
	var zoomLabel = Dom.el(doc, "span", {"class": "pb-lightbox-zoom"});
	var box = {zoom: 0};
	// zoom 0 = fit to the window; otherwise a factor of the natural size.
	var apply = function() {
		if (!box.zoom) {
			stage.classList.add("pb-fit");
			img.style.width = "";
			zoomLabel.textContent = "Fit";
		} else {
			stage.classList.remove("pb-fit");
			img.style.width = Math.round(img.naturalWidth * box.zoom) + "px";
			zoomLabel.textContent = Math.round(box.zoom * 100) + "%";
		}
	};
	var currentZoom = function() {
		return box.zoom || (img.naturalWidth ? img.clientWidth / img.naturalWidth : 1);
	};
	var setZoom = function(z, clientX, clientY) {
		var before = currentZoom();
		var rect = stage.getBoundingClientRect();
		var ox = clientX === undefined ? rect.width / 2 : clientX - rect.left;
		var oy = clientY === undefined ? rect.height / 2 : clientY - rect.top;
		var px = (stage.scrollLeft + ox) / before, py = (stage.scrollTop + oy) / before;
		box.zoom = Math.max(0.05, Math.min(8, z));
		apply();
		// Keep the point under the cursor in place.
		stage.scrollLeft = px * box.zoom - ox;
		stage.scrollTop = py * box.zoom - oy;
	};
	var lightbox = Dom.el(doc, "div", {"class": "pb-lightbox", role: "dialog", "aria-label": alt || "Image", tabindex: "-1"}, [
		stage,
		Dom.el(doc, "div", {"class": "pb-lightbox-controls"}, [
			Dom.button(doc, "minus", "Smaller", function() { setZoom(currentZoom() / 1.25); }),
			zoomLabel,
			Dom.button(doc, "plus", "Larger", function() { setZoom(currentZoom() * 1.25); }),
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "1:1", title: "Actual size", onclick: function() { setZoom(1); }}),
			Dom.button(doc, "map", "Fit to window", function() { box.zoom = 0; apply(); }),
			Dom.button(doc, "close", "Close (Esc)", function() { self.closeLightbox(); })
		])
	]);
	// Click on the picture: toggle between fitting and actual size.
	var drag = null;
	stage.addEventListener("pointerdown", function(e) {
		if (e.target === img && box.zoom) {
			drag = {x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false};
			try { stage.setPointerCapture(e.pointerId); } catch (err) {}
		}
	});
	stage.addEventListener("pointermove", function(e) {
		if (drag) {
			var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
			if (Math.abs(dx) + Math.abs(dy) > 3) {
				drag.moved = true;
			}
			stage.scrollLeft = drag.left - dx;
			stage.scrollTop = drag.top - dy;
		}
	});
	stage.addEventListener("pointerup", function() {
		setTimeout(function() { drag = null; }, 0);
	});
	stage.addEventListener("click", function(e) {
		if (e.target === img) {
			if (drag && drag.moved) {
				return;
			}
			if (box.zoom) {
				box.zoom = 0;
				apply();
			} else {
				setZoom(1, e.clientX, e.clientY);
			}
		} else if (e.target === stage) {
			self.closeLightbox();
		}
	});
	stage.addEventListener("wheel", function(e) {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			setZoom(currentZoom() * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
		}
	}, {passive: false});
	lightbox.addEventListener("keydown", function(e) {
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			self.closeLightbox();
		} else if (e.key === "+" || e.key === "=") {
			setZoom(currentZoom() * 1.25);
		} else if (e.key === "-") {
			setZoom(currentZoom() / 1.25);
		}
	});
	img.addEventListener("load", apply);
	this.lightbox = lightbox;
	host.appendChild(lightbox);
	apply();
	lightbox.focus({preventScroll: true});
};

methods.closeLightbox = function() {
	if (this.lightbox) {
		Dom.remove(this.lightbox);
		this.lightbox = null;
		if (this.modal) {
			this.modal.sheet.focus({preventScroll: true});
		} else if (!this.destroyed) {
			this.root.focus({preventScroll: true});
		}
	}
};
