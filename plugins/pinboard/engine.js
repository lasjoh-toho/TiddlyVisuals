/*\
title: $:/plugins/lasjoh-toho/pinboard/engine.js
type: application/javascript
module-type: graphengine

Pinboard: an infinite-canvas engine for TW5-Graph.

Nodes become cards that render chosen fields of their tiddlers with
TiddlyWiki's own renderer, edges are drawn between them, and a vector
drawing layer (pen, highlighter, shapes, text, sticky notes, presentation
frames) lives on the same canvas. Frames, cards and saved views can be
strung into a path that is played back as an immersive, zooming
presentation.

No third party libraries: everything is DOM + SVG with CSS transforms, so
cards stay real, interactive TiddlyWiki content (links, transclusions,
images) at every zoom level.

\*/

"use strict";

var Model = require("./lib/model.js");
var Camera = require("./lib/camera.js");
var Dom = require("./lib/dom.js");

exports.name = "Pinboard";

exports.properties = {
	graph: {
		store: {type: "string", description: "Tiddler which keeps the board's drawings, card sizes, chosen fields and presentation path"},
		storeField: {type: "string", default: "pinboard", description: "Field of the store tiddler holding the board data"},
		fields: {type: "string", default: "title text", description: "Fields shown on cards unless chosen otherwise per card"},
		cardTemplate: {type: "string", description: "Tiddler used to render card bodies"},
		cardWidth: {type: "number", min: 60, default: 240, description: "Default width of new cards"},
		textMode: {type: "enum", values: ["full", "break", "image", "imagebreak"], default: "full", description: "How much text cards show: everything, up to the first break, the first image, or both"},
		presentTextMode: {type: "enum", values: ["same", "full", "break", "image", "imagebreak"], default: "same", description: "How much text a card shows when the presentation stops at it"},
		background: {type: "color", description: "Board background color"},
		grid: {type: "boolean", default: true, description: "Show a dot grid behind the board"},
		editable: {type: "boolean", default: true, description: "Show drawing tools and allow editing the board"},
		zoom: {type: "boolean", default: true},
		focus: {type: "actions"},
		blur: {type: "actions"},
		doubleclick: {type: "actions", variables: ["x", "y"]},
		addNode: {type: "actions", variables: ["x", "y"]},
		addEdge: {type: "actions", variables: ["fromTiddler", "toTiddler"]},
		drop: {type: "actions", variables: ["dropTiddler"]}
	},
	nodes: {
		label: {type: "string"},
		color: {type: "color", default: "graph-node-color"},
		image: {type: "image"},
		x: {type: "number", hidden: true},
		y: {type: "number", hidden: true},
		width: {type: "number", min: 40, description: "Card width"},
		height: {type: "number", min: 30, description: "Card height (content height when unset)"},
		fields: {type: "string", description: "Fields shown on this card"},
		template: {type: "string", description: "Tiddler used to render this card's body"},
		hidden: {type: "boolean", default: false},
		actions: {type: "actions"},
		hover: {type: "actions"},
		blur: {type: "actions"},
		drag: {type: "actions"},
		free: {type: "actions", variables: ["x", "y"]},
		delete: {type: "actions", variables: []}
	},
	edges: {
		label: {type: "string"},
		color: {type: "color"},
		width: {type: "number", min: 0, default: 2, increment: 0.5},
		arrows: {type: "enum", default: "to", values: ["no", "to", "from", "middle"], hidden: ["no"], multiple: true},
		stroke: {type: "enum", values: ["solid", "dashed", "dotted"], default: "solid"},
		hidden: {type: "boolean", default: false},
		actions: {type: "actions"},
		hover: {type: "actions"},
		blur: {type: "actions"},
		delete: {type: "actions"}
	}
};

exports.messages = {
	"graph-move-view": {
		x: {type: "number"},
		y: {type: "number"},
		scale: {type: "number"},
		scaleBy: {type: "number"}
	},
	"graph-center-node": {
		tiddler: {type: "string"}
	},
	"graph-pinboard-present": {
		step: {type: "number"}
	},
	"graph-pinboard-fit": {},
	"graph-pinboard-open": {
		tiddler: {type: "string"}
	}
};

// Fold in the other parts of the engine.
["./lib/cards.js", "./lib/edges.js", "./lib/shapes.js", "./lib/ui.js", "./lib/presenter.js"].forEach(function(path) {
	var methods = require(path).methods;
	for (var name in methods) {
		exports[name] = methods[name];
	}
});

var TEMPLATE = "$:/plugins/lasjoh-toho/pinboard/templates/card";
var MIN_SCALE = 0.05, MAX_SCALE = 8;
var DRAG_THRESHOLD = 4;

/*** Lifecycle ***/

exports.init = function(element, objects, options) {
	options = options || {};
	this.wiki = options.wiki || $tw.wiki;
	this.parentWidget = options.widget || $tw.rootWidget;
	this.element = element;
	this.document = element.ownerDocument;
	this.window = this.document.defaultView;
	this.graph = {};
	this.nodes = Object.create(null);
	this.edges = Object.create(null);
	this.cards = Object.create(null);
	this.camera = {x: 0, y: 0, s: 1, r: 0};
	this.tool = "select";
	this.style = {stroke: "#1f2937", fill: "none", width: 3, fontSize: 24, noteColor: "#fde68a"};
	this.selection = null;
	this.undoStack = [];
	this.redoStack = [];
	this.pointers = Object.create(null);
	this.data = Model.emptyDoc();
	this.buildDom();
	this.onWikiChange = this.handleWikiChange.bind(this);
	this.wiki.addEventListener("change", this.onWikiChange);
	this.applyChanges(objects);
	this.initialView();
};

exports.update = function(objects) {
	this.applyChanges(objects);
};

exports.destroy = function() {
	if (this.destroyed) {
		return;
	}
	this.flushSave();
	this.destroyed = true;
	this.wiki.removeEventListener("change", this.onWikiChange);
	this.presenting && this.stopPresentation();
	this.closeModal && this.closeModal();
	this.closeEffects && this.closeEffects();
	for (var id in this.cards) {
		this.removeCard(id);
	}
	if (this.renderFrame) {
		this.window.cancelAnimationFrame(this.renderFrame);
	}
	if (this.cameraAnimation) {
		this.window.cancelAnimationFrame(this.cameraAnimation);
	}
	this.window.removeEventListener("resize", this.onResize);
	this.resizeObserver && this.resizeObserver.disconnect();
	this.document.removeEventListener("fullscreenchange", this.onFullscreenChange);
	Dom.remove(this.root);
};

exports.buildDom = function() {
	var doc = this.document, self = this;
	var children = Array.prototype.slice.call(this.element.childNodes);
	this.root = Dom.el(doc, "div", {"class": "pb-root", tabindex: "0"});
	this.viewport = Dom.el(doc, "div", {"class": "pb-viewport"});
	this.world = Dom.el(doc, "div", {"class": "pb-world"});
	this.backLayer = Dom.svg(doc, "svg", {"class": "pb-svg pb-layer-back"});
	this.edgeLayer = Dom.svg(doc, "svg", {"class": "pb-svg pb-layer-edges"});
	this.cardLayer = Dom.el(doc, "div", {"class": "pb-cards"});
	this.frontLayer = Dom.svg(doc, "svg", {"class": "pb-svg pb-layer-front"});
	this.uiLayer = Dom.svg(doc, "svg", {"class": "pb-svg pb-layer-ui"});
	this.world.appendChild(this.backLayer);
	this.world.appendChild(this.edgeLayer);
	this.world.appendChild(this.cardLayer);
	this.world.appendChild(this.frontLayer);
	this.world.appendChild(this.uiLayer);
	this.viewport.appendChild(this.world);
	this.root.appendChild(this.viewport);
	this.buildUi();
	// Elements already in the graph element (overlays rendered by TW5-Graph)
	// must stay, and stay after ours so they overlay the board.
	this.element.insertBefore(this.root, this.element.firstChild);
	for (var i = 0; i < children.length; i++) {
		this.element.appendChild(children[i]);
	}
	var on = function(target, type, method, opts) {
		target.addEventListener(type, method.bind(self), opts);
	};
	on(this.viewport, "pointerdown", this.handlePointerDown);
	on(this.viewport, "pointermove", this.handlePointerMove);
	on(this.viewport, "pointerup", this.handlePointerUp);
	on(this.viewport, "pointercancel", this.handlePointerUp);
	on(this.viewport, "dblclick", this.handleDoubleClick);
	on(this.viewport, "wheel", this.handleWheel, {passive: false});
	on(this.viewport, "dragover", this.handleDragOver);
	on(this.viewport, "drop", this.handleDrop);
	on(this.viewport, "pointerover", this.handlePointerOver);
	on(this.viewport, "pointerout", this.handlePointerOut);
	on(this.root, "keydown", this.handleKeyDown);
	on(this.root, "focusin", function(event) {
		if (!event.relatedTarget || !this.root.contains(event.relatedTarget)) {
			this.fire("graph", null, "focus", event);
		}
	});
	on(this.root, "focusout", function(event) {
		if (!event.relatedTarget || !this.root.contains(event.relatedTarget)) {
			this.fire("graph", null, "blur", event);
		}
	});
	// When the board changes size (fullscreen, window, sidebar), keep the
	// point in the middle of the view in the middle.
	this.onResize = function() {
		var size = self.viewSize();
		var last = self.lastSize;
		self.lastSize = size;
		if (last && (last.w !== size.w || last.h !== size.h) && !self.presenting) {
			self.setCamera({
				x: self.camera.x + (size.w - last.w) / 2,
				y: self.camera.y + (size.h - last.h) / 2,
				s: self.camera.s, r: self.camera.r
			});
		}
		self.scheduleRender();
	};
	this.window.addEventListener("resize", this.onResize);
	if (this.window.ResizeObserver) {
		this.resizeObserver = new this.window.ResizeObserver(this.onResize);
		this.resizeObserver.observe(this.viewport);
	}
};

/*** Applying graph objects ***/

exports.applyChanges = function(objects) {
	if (!objects) {
		return;
	}
	if (objects.graph) {
		var prevStore = this.storeKey();
		this.graph = objects.graph;
		this.applyGraphProperties();
		if (this.storeKey() !== prevStore) {
			this.loadData();
		}
	}
	var id;
	if (objects.nodes) {
		for (id in objects.nodes) {
			var node = objects.nodes[id];
			if (node === null) {
				delete this.nodes[id];
				this.removeCard(id);
			} else {
				this.nodes[id] = node;
				this.syncCard(id);
			}
		}
	}
	if (objects.edges) {
		for (id in objects.edges) {
			if (objects.edges[id] === null) {
				delete this.edges[id];
			} else {
				this.edges[id] = objects.edges[id];
			}
		}
	}
	this.scheduleRender();
};

exports.applyGraphProperties = function() {
	var g = this.graph;
	this.backgroundKey = null;
	$tw.utils.toggleClass(this.root, "pb-readonly", !this.isEditable());
	this.updateUi && this.updateUi();
	// Card templates and default fields may have changed.
	for (var id in this.cards) {
		this.syncCard(id);
	}
};

exports.isEditable = function() {
	return this.graph.editable !== false;
};

/*** Persistence ***/

exports.storeKey = function() {
	return (this.graph.store || "") + "\n" + (this.graph.storeField || "pinboard");
};

exports.loadData = function() {
	var store = this.graph.store;
	var text = store ? this.readStore() : "";
	this.lastSaved = text;
	this.data = Model.parseDoc(text);
	this.undoStack = [];
	this.redoStack = [];
	for (var id in this.cards) {
		this.cards[id].pos = undefined;
		this.syncCard(id);
	}
	this.selection = null;
	this.renderShapes && this.renderShapes();
	this.updateUi && this.updateUi();
	this.scheduleRender();
};

exports.readStore = function() {
	var tiddler = this.wiki.getTiddler(this.graph.store);
	var field = this.graph.storeField || "pinboard";
	return (tiddler && typeof tiddler.fields[field] === "string") ? tiddler.fields[field] : "";
};

/*
Call after every change to this.data. Debounced write to the store tiddler.
*/
exports.commit = function() {
	var self = this;
	this.renderShapes();
	this.scheduleRender();
	this.updateUi();
	if (!this.graph.store) {
		return;
	}
	if (this.saveTimer) {
		clearTimeout(this.saveTimer);
	}
	this.saveTimer = setTimeout(function() {
		self.saveTimer = null;
		self.writeStore();
	}, 350);
};

exports.flushSave = function() {
	if (this.saveTimer) {
		clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.writeStore();
	}
};

exports.writeStore = function() {
	var store = this.graph.store;
	if (!store || this.destroyed) {
		return;
	}
	var text = Model.serializeDoc(this.data);
	if (text === this.lastSaved) {
		return;
	}
	this.lastSaved = text;
	var fields = {title: store};
	fields[this.graph.storeField || "pinboard"] = text;
	var existing = this.wiki.getTiddler(store);
	this.wiki.addTiddler(new $tw.Tiddler(
		existing ? null : this.wiki.getCreationFields(),
		existing,
		fields,
		this.wiki.getModificationFields()));
};

/*
Snapshot for undo. Call before mutating this.data.
*/
exports.checkpoint = function() {
	this.undoStack.push(Model.serializeDoc(this.data));
	if (this.undoStack.length > 100) {
		this.undoStack.shift();
	}
	this.redoStack = [];
};

exports.undo = function() {
	if (this.undoStack.length) {
		this.redoStack.push(Model.serializeDoc(this.data));
		this.restoreSnapshot(this.undoStack.pop());
	}
};

exports.redo = function() {
	if (this.redoStack.length) {
		this.undoStack.push(Model.serializeDoc(this.data));
		this.restoreSnapshot(this.redoStack.pop());
	}
};

exports.restoreSnapshot = function(text) {
	this.data = Model.parseDoc(text);
	this.selection = null;
	for (var id in this.cards) {
		var stored = this.data.cards[id];
		if (!this.hasPropPosition(id) && stored && stored.x !== undefined) {
			this.cards[id].pos = {x: stored.x, y: stored.y};
		}
		this.syncCard(id);
	}
	this.commit();
};

exports.handleWikiChange = function(changes) {
	if (this.destroyed) {
		return;
	}
	if (this.isGarbage()) {
		// The graph widget will destroy us soon; don't do any more work.
		return;
	}
	var store = this.graph.store;
	if (store && changes[store] && !this.saveTimer) {
		var text = this.readStore();
		if (text !== this.lastSaved) {
			this.lastSaved = text;
			this.data = Model.parseDoc(text);
			for (var id in this.cards) {
				if (!this.hasPropPosition(id)) {
					this.cards[id].pos = undefined;
				}
				this.syncCard(id);
			}
			this.selection = null;
			this.renderShapes();
			this.updateUi();
		}
	}
	this.refreshCards(changes);
	if (this.filterText) {
		this.computeFilter();
		this.applyFilter();
	}
	this.refreshModal && this.refreshModal(changes);
	this.scheduleRender();
};

exports.isGarbage = function() {
	var body = this.document.body;
	return !body || !body.contains(this.root);
};

/*** Events towards TiddlyWiki ***/

exports.fire = function(objectType, id, type, event, variables) {
	if (!this.onevent) {
		return;
	}
	var props = objectType === "graph" ? this.graph :
		(objectType === "nodes" ? this.nodes[id] : this.edges[id]);
	if (!props || !props[type]) {
		return false;
	}
	var data = {type: type, objectType: objectType, event: event};
	if (objectType !== "graph") {
		data.id = id;
	}
	this.onevent(data, variables || {});
	return true;
};

exports.can = function(objectType, id, type) {
	var props = objectType === "graph" ? this.graph :
		(objectType === "nodes" ? this.nodes[id] : this.edges[id]);
	return !!(props && props[type]);
};

/*** Camera ***/

exports.viewSize = function() {
	return {w: this.viewport.clientWidth || 1, h: this.viewport.clientHeight || 1};
};

exports.setCamera = function(camera) {
	this.camera = {
		x: camera.x,
		y: camera.y,
		s: Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.s)),
		r: camera.r || 0
	};
	var c = this.camera;
	this.world.style.transform = Camera.transform(c);
	this.root.style.setProperty("--pb-inv", String(1 / c.s));
	var grid = 24 * c.s;
	while (grid < 12) {
		grid *= 4;
	}
	this.viewport.style.backgroundSize = grid + "px " + grid + "px";
	this.viewport.style.backgroundPosition = c.x + "px " + c.y + "px";
	this.renderSelection && this.renderSelection();
	this.updateZoomLabel && this.updateZoomLabel();
	this.positionPopups && this.positionPopups();
};

exports.animateCamera = function(target, duration, done) {
	var self = this;
	if (this.cameraAnimation) {
		this.window.cancelAnimationFrame(this.cameraAnimation);
		this.cameraAnimation = null;
	}
	var size = this.viewSize();
	var interpolate = Model.interpolateCamera(this.camera, target, size.w, size.h);
	duration = duration || interpolate.duration;
	var reduce = this.window.matchMedia && this.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (reduce) {
		duration = 0;
	}
	var start = null;
	var step = function(now) {
		if (start === null) {
			start = now;
		}
		var t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
		// ease in-out
		var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
		self.setCamera(interpolate(e));
		if (t < 1) {
			self.cameraAnimation = self.window.requestAnimationFrame(step);
		} else {
			self.cameraAnimation = null;
			done && done();
		}
	};
	this.cameraAnimation = this.window.requestAnimationFrame(step);
};

exports.flyTo = function(rect, padding, animate, rot) {
	var size = this.viewSize();
	var target = Model.fitRect(rect, size.w, size.h, padding, MAX_SCALE, rot || 0);
	if (animate === false) {
		this.setCamera(target);
	} else {
		this.animateCamera(target);
	}
};

exports.contentBounds = function() {
	var rects = [];
	for (var id in this.cards) {
		var r = this.cardRect(id);
		r && rects.push(r);
	}
	for (var i = 0; i < this.data.shapes.length; i++) {
		if (!this.data.shapes[i].hidden) {
			rects.push(Model.shapeBounds(this.data.shapes[i]));
		}
	}
	return Model.unionRects(rects);
};

exports.fitAll = function(animate) {
	var bounds = this.contentBounds();
	if (bounds) {
		this.flyTo(bounds, 0.06, animate);
	} else {
		var size = this.viewSize();
		this.setCamera({x: size.w / 2, y: size.h / 2, s: 1, r: 0});
	}
};

exports.initialView = function() {
	var self = this;
	// Wait for the first layout so cards have sizes.
	this.window.requestAnimationFrame(function() {
		if (self.destroyed) {
			return;
		}
		self.renderNow();
		if (self.data.view) {
			self.setCamera({x: self.data.view.x, y: self.data.view.y, s: self.data.view.scale, r: 0});
		} else {
			self.fitAll(false);
			if (self.camera.s > 1) {
				var size = self.viewSize();
				self.setCamera(Model.zoomAt(self.camera, 1 / self.camera.s, size.w / 2, size.h / 2, MIN_SCALE, MAX_SCALE));
			}
		}
	});
	this.setCamera(this.camera);
};

exports.zoomBy = function(factor, sx, sy) {
	var size = this.viewSize();
	if (sx === undefined) {
		sx = size.w / 2;
		sy = size.h / 2;
	}
	this.setCamera(Model.zoomAt(this.camera, factor, sx, sy, MIN_SCALE, MAX_SCALE));
};

exports.toWorld = function(clientX, clientY) {
	var rect = this.viewport.getBoundingClientRect();
	return Camera.toWorld(this.camera, clientX - rect.left, clientY - rect.top);
};

exports.toScreen = function(x, y) {
	return Camera.toScreen(this.camera, x, y);
};

/*** Rendering ***/

exports.scheduleRender = function() {
	var self = this;
	if (this.renderFrame || this.destroyed) {
		return;
	}
	this.renderFrame = this.window.requestAnimationFrame(function() {
		self.renderFrame = null;
		if (!self.destroyed) {
			self.renderNow();
		}
	});
};

exports.renderNow = function() {
	this.layoutCards();
	if (this.filterMatch && this.filterCardsCount !== Object.keys(this.cards).length) {
		// Cards were added or removed while filtering.
		this.filterCardsCount = Object.keys(this.cards).length;
		this.computeFilter();
		this.applyFilter();
	}
	this.renderEdges();
	this.renderSelection();
};

/*** Pointer input ***/

exports.handlePointerDown = function(event) {
	if (this.modal || this.presenting) {
		// The presentation player handles its own input.
		return;
	}
	this.pointers[event.pointerId] = {x: event.clientX, y: event.clientY};
	var ids = Object.keys(this.pointers);
	if (ids.length === 2) {
		// Second finger: switch to pinch, abandoning whatever was going on.
		this.cancelGesture();
		var a = this.pointers[ids[0]], b = this.pointers[ids[1]];
		this.gesture = {
			kind: "pinch",
			dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
			mid: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2},
			camera: this.camera
		};
		return;
	}
	if (ids.length > 2 || this.gesture) {
		return;
	}
	var target = event.target;
	if (target !== this.root && !this.root.contains(target)) {
		return;
	}
	// Toolbars and panels handle themselves.
	if (Dom.closest(target, ".pb-chrome", this.root)) {
		return;
	}
	// Working on the board closes the dock's flyout.
	this.closeFlyout && this.closeFlyout();
	if (!Dom.closest(target, "input, textarea, [contenteditable='true']", this.root)) {
		this.root.focus({preventScroll: true});
	}
	var world = this.toWorld(event.clientX, event.clientY);
	var start = {
		clientX: event.clientX, clientY: event.clientY,
		world: world, pointerId: event.pointerId, event: event
	};
	var gesture = null;
	var interactive = Dom.closest(target, Dom.INTERACTIVE, this.viewport);
	if (event.button === 1 || this.spaceDown) {
		gesture = this.startPan(start);
	} else if (event.button !== 0) {
		return;
	} else {
		gesture = this.startToolGesture(start, target, interactive);
	}
	if (gesture) {
		this.gesture = gesture;
		gesture.pointerId = event.pointerId;
		if (gesture.capture) {
			this.captureGesture(event);
		}
	}
};

exports.captureGesture = function(event) {
	try {
		this.viewport.setPointerCapture(event.pointerId);
	} catch (e) {}
	if (event.cancelable) {
		event.preventDefault();
	}
};

exports.startToolGesture = function(start, target, interactive) {
	var tool = this.isEditable() ? this.tool : "select";
	var handle = Dom.closest(target, "[data-pb-handle]", this.viewport);
	var cardEl = Dom.closest(target, ".pb-card", this.viewport);
	if (this.linking) {
		var from = this.linking.from;
		var to = cardEl && cardEl.getAttribute("data-pb-id");
		this.stopLinking();
		if (to && to !== from) {
			this.fire("graph", null, "addEdge", start.event, {fromTiddler: from, toTiddler: to});
			return null;
		}
	}
	if (handle) {
		return this.startHandleGesture(start, handle);
	}
	if (cardEl) {
		var cardPart = Dom.closest(target, "[data-pb-card-part]", cardEl);
		if (cardPart) {
			return this.startCardPartGesture(start, cardEl.getAttribute("data-pb-id"), cardPart.getAttribute("data-pb-card-part"));
		}
	}
	switch (tool) {
	case "hand":
		return this.startPan(start);
	case "pen":
	case "highlighter":
	case "rect":
	case "ellipse":
	case "line":
	case "arrow":
	case "frame":
		return this.startDrawGesture(start, tool);
	case "text":
	case "sticky":
		return {kind: "place", tool: tool, start: start, capture: true};
	case "curve":
	case "polygon":
		return {kind: "path-point", tool: tool, start: start, capture: true};
	case "eraser":
		return this.startEraseGesture(start);
	case "card":
		return {kind: "addnode", start: start, capture: true};
	}
	// Select tool.
	var shapeEl = Dom.closest(target, "[data-pb-shape]", this.viewport);
	var edgeEl = Dom.closest(target, "[data-pb-edge]", this.viewport);
	if (cardEl) {
		if (interactive) {
			return null;
		}
		return this.startCardDrag(start, cardEl.getAttribute("data-pb-id"));
	}
	if (shapeEl && this.isEditable()) {
		return this.startShapeDrag(start, shapeEl.getAttribute("data-pb-shape"));
	}
	if (edgeEl) {
		this.select({type: "edge", id: edgeEl.getAttribute("data-pb-edge")});
		return null;
	}
	this.select(null);
	return this.startPan(start);
};

exports.startPan = function(start) {
	return {kind: "pan", start: start, camera: this.camera, capture: true, cursor: true};
};

exports.handlePointerMove = function(event) {
	if (this.pointers[event.pointerId]) {
		this.pointers[event.pointerId] = {x: event.clientX, y: event.clientY};
	}
	var g = this.gesture;
	if (!g) {
		if (this.pathDraft) {
			this.movePathPreview(this.toWorld(event.clientX, event.clientY));
		}
		return;
	}
	if (g.kind === "pinch") {
		var ids = Object.keys(this.pointers);
		if (ids.length < 2) {
			return;
		}
		var a = this.pointers[ids[0]], b = this.pointers[ids[1]];
		var dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
		var mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
		var rect = this.viewport.getBoundingClientRect();
		var cam = Model.zoomAt(g.camera, dist / g.dist, g.mid.x - rect.left, g.mid.y - rect.top, MIN_SCALE, MAX_SCALE);
		cam.x += mid.x - g.mid.x;
		cam.y += mid.y - g.mid.y;
		this.setCamera(cam);
		return;
	}
	if (event.pointerId !== g.pointerId) {
		return;
	}
	var dx = event.clientX - g.start.clientX, dy = event.clientY - g.start.clientY;
	if (!g.moved) {
		if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD && g.kind !== "draw" && g.kind !== "erase") {
			return;
		}
		g.moved = true;
		if (!g.capture) {
			this.captureGesture(event);
		}
		if (g.cursor) {
			this.root.classList.add("pb-panning");
		}
		g.onStart && g.onStart.call(this, g);
	}
	var world = this.toWorld(event.clientX, event.clientY);
	switch (g.kind) {
	case "pan":
		this.setCamera({x: g.camera.x + dx, y: g.camera.y + dy, s: g.camera.s, r: g.camera.r});
		break;
	default:
		g.onMove && g.onMove.call(this, g, world, event);
	}
};

exports.handlePointerUp = function(event) {
	delete this.pointers[event.pointerId];
	var g = this.gesture;
	if (!g) {
		return;
	}
	if (g.kind === "pinch") {
		if (Object.keys(this.pointers).length === 0) {
			this.gesture = null;
			this.rememberView();
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
	var world = this.toWorld(event.clientX, event.clientY);
	if (event.type === "pointercancel") {
		g.onCancel && g.onCancel.call(this, g);
		return;
	}
	switch (g.kind) {
	case "pan":
		if (g.moved) {
			this.rememberView();
		}
		break;
	case "place":
		this.placeTextShape(g.tool, world);
		break;
	case "path-point":
		this.addPathPoint(g.tool, world);
		break;
	case "addnode":
		if (this.can("graph", null, "addNode")) {
			this.pendingPosition = {x: Model.round(world.x), y: Model.round(world.y), time: Date.now()};
			this.fire("graph", null, "addNode", event, {x: Model.round(world.x), y: Model.round(world.y)});
		}
		this.setTool("select");
		break;
	default:
		if (g.moved || g.alwaysEnd) {
			g.onEnd && g.onEnd.call(this, g, world, event);
		} else {
			g.onClick && g.onClick.call(this, g, world, event);
		}
	}
};

exports.cancelGesture = function() {
	var g = this.gesture;
	if (g && g.onCancel) {
		g.onCancel.call(this, g);
	}
	this.gesture = null;
	this.root.classList.remove("pb-panning");
};

/*
The camera is remembered on the board (debounced) so the board re-opens
where it was left.
*/
exports.rememberView = function() {
	var self = this;
	if (!this.graph.store || this.presenting) {
		return;
	}
	if (this.viewTimer) {
		clearTimeout(this.viewTimer);
	}
	this.viewTimer = setTimeout(function() {
		self.viewTimer = null;
		if (self.destroyed) {
			return;
		}
		var c = self.camera;
		self.data.view = {x: Math.round(c.x), y: Math.round(c.y), scale: Math.round(c.s * 1000) / 1000};
		self.writeStore();
	}, 800);
};

exports.handleWheel = function(event) {
	if (this.modal || this.presenting || this.graph.zoom === false) {
		return;
	}
	if (!event.ctrlKey && this.canScrollInside(event.target, event.deltaY)) {
		return;
	}
	event.preventDefault();
	var rect = this.viewport.getBoundingClientRect();
	var sx = event.clientX - rect.left, sy = event.clientY - rect.top;
	if (event.shiftKey && !event.ctrlKey) {
		this.setCamera({x: this.camera.x - event.deltaY, y: this.camera.y - event.deltaX, s: this.camera.s, r: this.camera.r});
	} else {
		var delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
		var factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015));
		this.setCamera(Model.zoomAt(this.camera, factor, sx, sy, MIN_SCALE, MAX_SCALE));
	}
	this.rememberView();
};

exports.canScrollInside = function(node, deltaY) {
	while (node && node !== this.viewport) {
		if (node.nodeType === 1 && node.scrollHeight > node.clientHeight + 1) {
			var overflow = this.window.getComputedStyle(node).overflowY;
			if (overflow === "auto" || overflow === "scroll") {
				if ((deltaY < 0 && node.scrollTop > 0) ||
					(deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1)) {
					return true;
				}
			}
		}
		node = node.parentNode;
	}
	return false;
};

exports.handleDoubleClick = function(event) {
	if (this.modal || this.presenting) {
		return;
	}
	if (this.pathDraft) {
		this.finishPath();
		return;
	}
	var target = event.target;
	if (Dom.closest(target, ".pb-chrome", this.root)) {
		return;
	}
	var cardEl = Dom.closest(target, ".pb-card", this.viewport);
	if (cardEl) {
		if (Dom.closest(target, Dom.INTERACTIVE, cardEl)) {
			return;
		}
		var id = cardEl.getAttribute("data-pb-id");
		if (!this.fire("nodes", id, "actions", event)) {
			this.openModal(id);
		}
		return;
	}
	var shapeEl = Dom.closest(target, "[data-pb-shape]", this.viewport);
	if (shapeEl && this.isEditable()) {
		var shape = Model.findShape(this.data, shapeEl.getAttribute("data-pb-shape"));
		if (shape && Model.hasText(shape.type)) {
			this.editShapeText(shape);
		}
		return;
	}
	var edgeEl = Dom.closest(target, "[data-pb-edge]", this.viewport);
	if (edgeEl) {
		this.fire("edges", edgeEl.getAttribute("data-pb-edge"), "actions", event);
		return;
	}
	if (this.tool === "select" || !this.isEditable()) {
		var world = this.toWorld(event.clientX, event.clientY);
		var vars = {x: Model.round(world.x), y: Model.round(world.y)};
		this.pendingPosition = {x: vars.x, y: vars.y, time: Date.now()};
		this.fire("graph", null, "doubleclick", event, vars);
	}
};

exports.handleDragOver = function(event) {
	if (this.can("graph", null, "drop")) {
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}
};

exports.handleDrop = function(event) {
	if (!this.can("graph", null, "drop")) {
		return;
	}
	var title = getDroppedTitle(event.dataTransfer);
	if (title) {
		event.preventDefault();
		event.stopPropagation();
		var world = this.toWorld(event.clientX, event.clientY);
		this.pendingPosition = {x: Model.round(world.x), y: Model.round(world.y), time: Date.now(), title: title};
		this.fire("graph", null, "drop", event, {dropTiddler: title});
	}
};

function getDroppedTitle(dataTransfer) {
	if (!dataTransfer) {
		return null;
	}
	var json = dataTransfer.getData("text/vnd.tiddler");
	if (json) {
		try {
			var parsed = JSON.parse(json);
			if (parsed && parsed.title) {
				return parsed.title;
			}
		} catch (e) {}
	}
	var text = dataTransfer.getData("text/plain");
	return text ? text.trim().split("\n")[0] : null;
}

exports.handlePointerOver = function(event) {
	var cardEl = Dom.closest(event.target, ".pb-card", this.viewport);
	var edgeEl = Dom.closest(event.target, "[data-pb-edge]", this.viewport);
	var hovered = cardEl ? "n:" + cardEl.getAttribute("data-pb-id") :
		(edgeEl ? "e:" + edgeEl.getAttribute("data-pb-edge") : null);
	this.setHovered(hovered, event);
};

exports.handlePointerOut = function(event) {
	if (!event.relatedTarget || !this.viewport.contains(event.relatedTarget)) {
		this.setHovered(null, event);
	}
};

exports.setHovered = function(key, event) {
	if (key === this.hovered) {
		return;
	}
	var prev = this.hovered;
	this.hovered = key;
	if (prev) {
		this.fire(prev.charAt(0) === "n" ? "nodes" : "edges", prev.substr(2), "blur", event);
	}
	if (key) {
		this.fire(key.charAt(0) === "n" ? "nodes" : "edges", key.substr(2), "hover", event);
	}
};

/*** Keyboard ***/

var TOOL_KEYS = {v: "select", h: "hand", p: "pen", m: "highlighter", b: "curve", r: "rect", o: "ellipse", g: "polygon", l: "line", a: "arrow", t: "text", n: "sticky", f: "frame", e: "eraser", c: "card"};

exports.handleKeyDown = function(event) {
	if (this.modal) {
		if (event.key === "Escape") {
			this.closeModal();
			event.preventDefault();
		}
		return;
	}
	var target = event.target;
	if (Dom.closest(target, "input, textarea, select, [contenteditable='true']", this.root)) {
		return;
	}
	if (this.presenting) {
		// The presentation player listens on the same element.
		return;
	}
	var key = event.key;
	var mod = event.ctrlKey || event.metaKey;
	var handled = true;
	if (mod && (key === "z" || key === "Z")) {
		if (event.shiftKey) {
			this.redo();
		} else {
			this.undo();
		}
	} else if (mod && (key === "y" || key === "Y")) {
		this.redo();
	} else if (mod && (key === "d" || key === "D")) {
		this.duplicateSelection();
	} else if (mod) {
		handled = false;
	} else if (key === "Delete" || key === "Backspace") {
		this.deleteSelection();
	} else if (this.pathDraft && (key === "Enter" || key === "Escape")) {
		this.finishPath();
	} else if (key === "Escape") {
		this.stopLinking();
		this.select(null);
		this.setTool("select");
	} else if (key === " ") {
		if (!this.spaceDown) {
			this.spaceDown = true;
			this.root.classList.add("pb-space");
			var self = this;
			var up = function(e) {
				if (e.key === " ") {
					self.spaceDown = false;
					self.root.classList.remove("pb-space");
					self.root.removeEventListener("keyup", up);
				}
			};
			this.root.addEventListener("keyup", up);
		}
	} else if (key === "+" || key === "=") {
		this.zoomBy(1.25);
	} else if (key === "-") {
		this.zoomBy(0.8);
	} else if (key === "0") {
		this.fitAll(true);
	} else if (TOOL_KEYS[key] && this.isEditable()) {
		this.setTool(TOOL_KEYS[key]);
	} else if (key.indexOf("Arrow") === 0 && this.selection && this.selection.type === "shape") {
		var step = event.shiftKey ? 10 : 1;
		var shape = Model.findShape(this.data, this.selection.id);
		if (shape) {
			this.checkpoint();
			Model.translateShape(shape,
				key === "ArrowLeft" ? -step : (key === "ArrowRight" ? step : 0),
				key === "ArrowUp" ? -step : (key === "ArrowDown" ? step : 0));
			this.commit();
		}
	} else {
		handled = false;
	}
	if (handled) {
		event.preventDefault();
		event.stopPropagation();
	}
};

/*** Selection ***/

exports.select = function(selection) {
	var prev = this.selection;
	if (prev && selection && prev.type === selection.type && prev.id === selection.id) {
		return;
	}
	this.selection = selection;
	for (var id in this.cards) {
		$tw.utils.toggleClass(this.cards[id].el, "pb-selected", !!(selection && selection.type === "card" && selection.id === id));
	}
	this.renderEdges();
	this.renderSelection();
	this.updateUi();
};

exports.deleteSelection = function() {
	var sel = this.selection;
	if (!sel) {
		return;
	}
	if (sel.type === "shape" && this.isEditable()) {
		this.checkpoint();
		Model.removeShape(this.data, sel.id);
		this.selection = null;
		this.commit();
	} else if (sel.type === "card") {
		this.fire("nodes", sel.id, "delete", null);
	} else if (sel.type === "edge") {
		this.fire("edges", sel.id, "delete", null);
	}
};

exports.duplicateSelection = function() {
	var sel = this.selection;
	if (!sel || sel.type !== "shape" || !this.isEditable()) {
		return;
	}
	var shape = Model.findShape(this.data, sel.id);
	if (shape) {
		this.checkpoint();
		var copy = JSON.parse(JSON.stringify(shape));
		copy.id = Model.newId("s");
		Model.translateShape(copy, 20, 20);
		this.data.shapes.push(copy);
		this.selection = {type: "shape", id: copy.id};
		this.commit();
	}
};

/*** Messages ***/

exports.handleMessage = function(message, params) {
	switch (message.type) {
	case "graph-move-view":
		var size = this.viewSize();
		var scale = params.scale !== undefined ? params.scale :
			(params.scaleBy !== undefined ? this.camera.s * params.scaleBy : this.camera.s);
		var center = Camera.toWorld(this.camera, size.w / 2, size.h / 2);
		var cx = params.x !== undefined ? params.x : center.x;
		var cy = params.y !== undefined ? params.y : center.y;
		this.animateCamera(Camera.cameraAt(cx, cy, scale, this.camera.r, size.w, size.h));
		break;
	case "graph-center-node":
		var rect = this.cardRect(params.tiddler || message.param);
		if (rect) {
			this.flyTo(rect, 0.2);
		}
		break;
	case "graph-pinboard-fit":
		this.fitAll(true);
		break;
	case "graph-pinboard-present":
		this.startPresentation(params.step ? params.step - 1 : 0);
		break;
	case "graph-pinboard-open":
		var title = params.tiddler || message.param;
		if (title) {
			this.openModal(title);
		}
		break;
	}
};

exports.TEMPLATE = TEMPLATE;
