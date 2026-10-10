/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/shapes.js
type: application/javascript
module-type: library

The Pinboard's drawing layer: freehand pen and highlighter strokes,
rectangles, ellipses, lines, arrows, text, sticky notes and presentation
frames. Shapes are vectors in board coordinates, so they stay crisp at
every zoom level and are stored as plain JSON.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var XHTML = "http://www.w3.org/1999/xhtml";
var STICKY_FILL = "#fde68a";
var FRAME_COLOR = "#6366f1";

var methods = exports.methods = {};

/*** Rendering ***/

methods.renderShapes = function() {
	Dom.clear(this.backLayer);
	Dom.clear(this.frontLayer);
	this.shapeEls = Object.create(null);
	this.frameNumbers = Object.create(null);
	var steps = this.data.steps;
	for (var i = 0; i < steps.length; i++) {
		if (steps[i].kind === "frame" && !this.frameNumbers[steps[i].ref]) {
			this.frameNumbers[steps[i].ref] = i + 1;
		}
	}
	for (var i = 0; i < this.data.shapes.length; i++) {
		var shape = this.data.shapes[i];
		var el = this.buildShape(shape);
		this.shapeEls[shape.id] = el;
		(shape.layer === "back" ? this.backLayer : this.frontLayer).appendChild(el);
	}
	this.renderSelection();
};

methods.updateShapeEl = function(shape) {
	var old = this.shapeEls && this.shapeEls[shape.id];
	var el = this.buildShape(shape);
	if (old && old.parentNode) {
		old.parentNode.replaceChild(el, old);
	} else {
		(shape.layer === "back" ? this.backLayer : this.frontLayer).appendChild(el);
	}
	this.shapeEls[shape.id] = el;
};

methods.buildShape = function(shape) {
	var doc = this.document;
	var svg = function(tag, attrs) { return Dom.svg(doc, tag, attrs); };
	var g = svg("g", {"class": "pb-shape pb-shape-" + shape.type, "data-pb-shape": shape.id});
	var stroke = shape.stroke, fill = shape.fill, width = shape.width;
	var visual, hit;
	switch (shape.type) {
	case "pen":
	case "highlighter":
		var d = Model.smoothPath(shape.points);
		hit = svg("path", {d: d});
		visual = svg("path", {d: d, fill: "none", stroke: stroke, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round"});
		if (shape.type === "highlighter") {
			visual.setAttribute("stroke-opacity", "0.38");
		}
		break;
	case "line":
	case "arrow":
		var p0 = shape.points[0], p1 = shape.points[shape.points.length - 1];
		var lineD = "M" + p0[0] + " " + p0[1] + "L" + p1[0] + " " + p1[1];
		hit = svg("path", {d: lineD});
		visual = svg("g");
		var end = p1;
		if (shape.type === "arrow") {
			var size = 8 + width * 2.5;
			var len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
			var ux = (p1[0] - p0[0]) / len, uy = (p1[1] - p0[1]) / len;
			// Stop the shaft inside the head so the tip stays sharp.
			end = [p1[0] - ux * size * 0.6, p1[1] - uy * size * 0.6];
			var bx = p1[0] - ux * size, by = p1[1] - uy * size;
			var px = -uy * size * 0.55, py = ux * size * 0.55;
			visual.appendChild(svg("path", {
				d: "M" + p1[0] + " " + p1[1] + "L" + (bx + px) + " " + (by + py) + "L" + (bx - px) + " " + (by - py) + "Z",
				fill: stroke, stroke: stroke, "stroke-width": 1, "stroke-linejoin": "round"}));
		}
		visual.insertBefore(svg("path", {
			d: "M" + p0[0] + " " + p0[1] + "L" + end[0] + " " + end[1],
			fill: "none", stroke: stroke, "stroke-width": width, "stroke-linecap": "round"}), visual.firstChild);
		break;
	case "rect":
	case "frame":
	case "sticky":
	case "text":
		var attrs = {x: shape.x, y: shape.y, width: shape.w, height: shape.h};
		hit = svg("rect", attrs);
		if (shape.type === "rect") {
			visual = svg("rect", $tw.utils.extend({rx: 8, fill: fill, stroke: stroke, "stroke-width": width}, attrs));
		} else if (shape.type === "frame") {
			visual = svg("g");
			visual.appendChild(svg("rect", $tw.utils.extend({rx: 4, fill: "none", stroke: stroke || FRAME_COLOR, "stroke-width": Math.max(width, 1.5), "stroke-dasharray": "10 7", "class": "pb-frame-border"}, attrs)));
			var number = this.frameNumbers && this.frameNumbers[shape.id];
			var label = svg("text", {x: shape.x + 2, y: shape.y - 10, "class": "pb-frame-label", fill: stroke || FRAME_COLOR});
			label.textContent = (number ? number + " · " : "") + (shape.text || "Frame");
			visual.appendChild(label);
		} else if (shape.type === "sticky") {
			visual = svg("rect", $tw.utils.extend({rx: 3, fill: fill === "none" ? STICKY_FILL : fill, "class": "pb-sticky-paper"}, attrs));
		} else {
			visual = svg("rect", $tw.utils.extend({fill: "none", stroke: "none"}, attrs));
		}
		break;
	case "ellipse":
		var eAttrs = {cx: shape.x + shape.w / 2, cy: shape.y + shape.h / 2, rx: shape.w / 2, ry: shape.h / 2};
		hit = svg("ellipse", eAttrs);
		visual = svg("ellipse", $tw.utils.extend({fill: fill, stroke: stroke, "stroke-width": width}, eAttrs));
		break;
	}
	if (!visual) {
		return g;
	}
	visual.setAttribute("pointer-events", "none");
	// The hit area is a wider, invisible copy of the shape.
	var solid = shape.type === "text" || shape.type === "sticky" || (fill && fill !== "none" && shape.type !== "frame");
	Dom.setAttrs(hit, {
		"class": "pb-hit",
		fill: solid ? "transparent" : "none",
		stroke: "transparent",
		"stroke-width": Math.max(14, width + 10),
		"pointer-events": solid ? "all" : "stroke"
	});
	g.appendChild(visual);
	if (Model.hasText(shape.type) && shape.type !== "frame" && shape.text) {
		g.appendChild(this.buildShapeText(shape));
	}
	g.appendChild(hit);
	if (shape.rot && Model.isBoxType(shape.type)) {
		g.setAttribute("transform", "rotate(" + shape.rot + " " + (shape.x + shape.w / 2) + " " + (shape.y + shape.h / 2) + ")");
	}
	return g;
};

methods.buildShapeText = function(shape) {
	var doc = this.document;
	var fo = Dom.svg(doc, "foreignObject", {x: shape.x, y: shape.y, width: shape.w, height: shape.h, "pointer-events": "none"});
	var div = doc.createElementNS(XHTML, "div");
	div.className = "pb-shape-text pb-shape-text-" + shape.type;
	div.style.fontSize = (shape.fontSize || defaultFontSize(shape.type)) + "px";
	div.style.color = shape.type === "sticky" ? "#1f2937" : shape.stroke;
	div.textContent = shape.text;
	fo.appendChild(div);
	return fo;
};

function defaultFontSize(type) {
	return type === "text" ? 24 : (type === "sticky" ? 18 : 16);
}

methods.renderSelection = function() {
	if (!this.uiLayer) {
		return;
	}
	var doc = this.document;
	Dom.clear(this.uiLayer);
	var sel = this.selection;
	if (!sel || sel.type !== "shape" || this.presenting) {
		this.positionContextBar && this.positionContextBar();
		return;
	}
	var shape = Model.findShape(this.data, sel.id);
	if (!shape) {
		this.selection = null;
		this.positionContextBar && this.positionContextBar();
		return;
	}
	var inv = 1 / this.camera.s;
	var box = Model.isBoxType(shape.type);
	// Box shapes are outlined in their own (rotated) frame.
	var b = box ? {x: shape.x, y: shape.y, w: shape.w, h: shape.h} : Model.shapeBounds(shape);
	var group = Dom.svg(doc, "g", box && shape.rot ? {
		transform: "rotate(" + shape.rot + " " + (b.x + b.w / 2) + " " + (b.y + b.h / 2) + ")"
	} : null);
	this.uiLayer.appendChild(group);
	var pad = 4 * inv;
	group.appendChild(Dom.svg(doc, "rect", {
		"class": "pb-selection-box",
		x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad,
		"stroke-width": 1.5 * inv,
		"stroke-dasharray": (5 * inv) + " " + (4 * inv)
	}));
	if (this.isEditable()) {
		var size = 11 * inv;
		var handles;
		if (shape.type === "line" || shape.type === "arrow") {
			var p0 = shape.points[0], p1 = shape.points[shape.points.length - 1];
			handles = [["p0", p0[0], p0[1]], ["p1", p1[0], p1[1]]];
		} else {
			handles = [
				["nw", b.x - pad, b.y - pad], ["ne", b.x + b.w + pad, b.y - pad],
				["sw", b.x - pad, b.y + b.h + pad], ["se", b.x + b.w + pad, b.y + b.h + pad]];
		}
		if (box) {
			var top = b.y - pad - 26 * inv;
			group.appendChild(Dom.svg(doc, "line", {
				"class": "pb-rotate-stem",
				x1: b.x + b.w / 2, y1: b.y - pad, x2: b.x + b.w / 2, y2: top,
				"stroke-width": 1.5 * inv
			}));
			group.appendChild(Dom.svg(doc, "circle", {
				"class": "pb-handle pb-handle-rot",
				"data-pb-handle": "rot",
				cx: b.x + b.w / 2, cy: top, r: 6.5 * inv,
				"stroke-width": 1.5 * inv
			}));
		}
		for (var i = 0; i < handles.length; i++) {
			var h = handles[i];
			group.appendChild(Dom.svg(doc, "rect", {
				"class": "pb-handle pb-handle-" + h[0],
				"data-pb-handle": h[0],
				x: h[1] - size / 2, y: h[2] - size / 2, width: size, height: size,
				rx: 2 * inv, "stroke-width": 1.5 * inv
			}));
		}
	}
	this.positionContextBar && this.positionContextBar();
};

/*** Tools ***/

methods.setTool = function(tool) {
	if (!this.isEditable()) {
		tool = "select";
	}
	this.tool = tool;
	this.root.setAttribute("data-pb-tool", tool);
	if (tool !== "select") {
		this.closeChooser && this.closeChooser();
	}
	this.updateUi();
};

methods.newShapeStyle = function(type) {
	var style = this.style;
	var shape = {id: Model.newId("s"), type: type, stroke: style.stroke, fill: "none", width: style.width, layer: "front"};
	switch (type) {
	case "highlighter":
		shape.width = style.width * 5;
		break;
	case "rect":
	case "ellipse":
		shape.fill = style.fill;
		shape.layer = "back";
		break;
	case "frame":
		shape.stroke = FRAME_COLOR;
		shape.width = 2;
		shape.layer = "back";
		break;
	case "sticky":
		shape.fill = (style.fill && style.fill !== "none") ? style.fill : STICKY_FILL;
		break;
	}
	return shape;
};

methods.startDrawGesture = function(start, tool) {
	var shape = this.newShapeStyle(tool);
	var p = [Model.round(start.world.x), Model.round(start.world.y)];
	var self = this;
	if (Model.isPointType(tool)) {
		shape.points = [p, p.slice()];
	} else {
		shape.x = p[0]; shape.y = p[1]; shape.w = 0; shape.h = 0;
	}
	var added = false;
	var add = function() {
		if (!added) {
			added = true;
			self.checkpoint();
			self.data.shapes.push(shape);
			if (tool === "frame") {
				self.data.steps.push({id: Model.newId("t"), kind: "frame", ref: shape.id});
			}
			self.renderShapes();
		}
	};
	return {
		kind: "draw",
		start: start,
		capture: true,
		alwaysEnd: true,
		onStart: function() {
			add();
		},
		onMove: function(g, world, event) {
			var x = Model.round(world.x), y = Model.round(world.y);
			if (tool === "pen" || tool === "highlighter") {
				var last = shape.points[shape.points.length - 1];
				if (Math.hypot(x - last[0], y - last[1]) * this.camera.s >= 1.5) {
					shape.points.push([x, y]);
				}
			} else if (tool === "line" || tool === "arrow") {
				if (event.shiftKey) {
					var dx = x - p[0], dy = y - p[1];
					var angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
					var len = Math.hypot(dx, dy);
					x = Model.round(p[0] + Math.cos(angle) * len);
					y = Model.round(p[1] + Math.sin(angle) * len);
				}
				shape.points = [p, [x, y]];
			} else {
				var w = x - p[0], h = y - p[1];
				if (event.shiftKey) {
					var m = Math.max(Math.abs(w), Math.abs(h));
					w = w < 0 ? -m : m;
					h = h < 0 ? -m : m;
				}
				var rect = Model.normalizeRect({x: p[0], y: p[1], w: w, h: h});
				shape.x = rect.x; shape.y = rect.y; shape.w = rect.w; shape.h = rect.h;
			}
			this.updateShapeEl(shape);
		},
		onEnd: function(g, world) {
			add();
			var tiny = 4 / this.camera.s;
			if (tool === "pen" || tool === "highlighter") {
				shape.points = Model.simplifyPoints(shape.points, 0.8 / this.camera.s);
				if (shape.points.length < 2) {
					shape.points.push([shape.points[0][0] + 0.1, shape.points[0][1]]);
				}
			} else if (tool === "line" || tool === "arrow") {
				var a = shape.points[0], b = shape.points[1];
				if (Math.hypot(b[0] - a[0], b[1] - a[1]) < tiny) {
					return this.discardShape(shape);
				}
			} else if (shape.w < tiny || shape.h < tiny) {
				if (tool !== "frame") {
					return this.discardShape(shape);
				}
				// A click with the frame tool drops a 16:9 frame the size of
				// half the current view.
				var size = this.viewSize();
				var fw = Model.round(size.w * 0.5 / this.camera.s);
				var fh = Model.round(fw * 9 / 16);
				shape.x = Model.round(p[0] - fw / 2); shape.y = Model.round(p[1] - fh / 2);
				shape.w = fw; shape.h = fh;
			}
			if (tool !== "pen" && tool !== "highlighter") {
				this.selection = {type: "shape", id: shape.id};
			}
			this.commit();
		},
		onCancel: function() {
			if (added) {
				this.discardShape(shape);
			}
		}
	};
};

methods.discardShape = function(shape) {
	// The checkpoint taken when it was added would now undo nothing.
	this.undoStack.pop();
	Model.removeShape(this.data, shape.id);
	this.renderShapes();
	this.updateUi();
};

methods.placeTextShape = function(tool, world) {
	var shape = this.newShapeStyle(tool);
	if (tool === "sticky") {
		shape.x = Model.round(world.x - 90); shape.y = Model.round(world.y - 90);
		shape.w = 180; shape.h = 180;
	} else {
		var fontSize = Math.round(24 / Math.max(0.25, Math.min(4, this.camera.s)));
		shape.fontSize = fontSize;
		shape.x = Model.round(world.x); shape.y = Model.round(world.y - fontSize * 0.75);
		shape.w = Math.round(fontSize * 12); shape.h = Math.round(fontSize * 2);
	}
	this.checkpoint();
	this.data.shapes.push(shape);
	this.selection = {type: "shape", id: shape.id};
	this.commit();
	this.editShapeText(shape, true);
	this.setTool("select");
};

methods.editShapeText = function(shape, isNew) {
	var self = this, doc = this.document;
	this.finishTextEdit && this.textEditor && this.finishTextEdit();
	var screen = this.toScreen(shape.x, shape.y);
	var s = this.camera.s;
	var fontSize = (shape.fontSize || defaultFontSize(shape.type)) * s;
	var area = Dom.el(doc, "textarea", {
		"class": "pb-text-editor pb-chrome pb-text-editor-" + shape.type,
		placeholder: shape.type === "frame" ? "Frame title" : "Type here",
		style: {
			left: screen.x + "px",
			top: screen.y + "px",
			width: Math.max(80, shape.w * s) + "px",
			height: shape.type === "frame" ? "2.4em" : Math.max(32, shape.h * s) + "px",
			fontSize: shape.type === "frame" ? "14px" : fontSize + "px",
			color: shape.type === "sticky" ? "#1f2937" : (shape.type === "frame" ? "" : shape.stroke)
		}
	});
	area.value = shape.text || "";
	if (shape.type === "frame") {
		area.style.top = (screen.y - 36) + "px";
	}
	var original = shape.text || "";
	var done = false;
	this.finishTextEdit = function(cancel) {
		if (done) {
			return;
		}
		done = true;
		self.textEditor = null;
		var value = cancel ? original : area.value.replace(/\s+$/, "");
		Dom.remove(area);
		if (isNew && !value && shape.type === "text") {
			self.undoStack.pop();
			Model.removeShape(self.data, shape.id);
			self.selection = null;
			self.commit();
		} else if (value !== original) {
			if (!isNew) {
				self.checkpoint();
			}
			if (value) {
				shape.text = value;
			} else {
				delete shape.text;
			}
			if (shape.type === "text") {
				// Grow the box to fit the text.
				var lines = value.split("\n");
				var longest = lines.reduce(function(m, l) { return Math.max(m, l.length); }, 0);
				var fs = shape.fontSize || defaultFontSize("text");
				shape.w = Math.max(shape.w, Math.round(longest * fs * 0.6 + fs));
				shape.h = Math.max(shape.h, Math.round(lines.length * fs * 1.3 + fs * 0.4));
			}
			self.commit();
		}
		self.root.focus({preventScroll: true});
	};
	this.textEditor = area;
	area.addEventListener("blur", function() { self.finishTextEdit(); });
	area.addEventListener("keydown", function(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			self.finishTextEdit(true);
		} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey || shape.type === "frame")) {
			event.preventDefault();
			self.finishTextEdit();
		}
	});
	this.root.appendChild(area);
	area.focus();
	area.select();
};

/*** Moving, resizing, erasing ***/

function copyGeometry(dst, src) {
	if (src.points) {
		dst.points = src.points.map(function(p) { return p.slice(); });
	} else {
		dst.x = src.x; dst.y = src.y; dst.w = src.w; dst.h = src.h;
	}
}

methods.startShapeDrag = function(start, id) {
	var shape = Model.findShape(this.data, id);
	if (!shape) {
		return null;
	}
	this.select({type: "shape", id: id});
	var original = JSON.parse(JSON.stringify(shape));
	return {
		kind: "shape",
		start: start,
		onStart: function() { this.checkpoint(); },
		onMove: function(g, world) {
			copyGeometry(shape, original);
			Model.translateShape(shape, world.x - start.world.x, world.y - start.world.y);
			this.updateShapeEl(shape);
			this.renderSelection();
		},
		onEnd: function() { this.commit(); },
		onCancel: function() {
			copyGeometry(shape, original);
			this.renderShapes();
		}
	};
};

methods.startHandleGesture = function(start, handleEl) {
	var sel = this.selection;
	var shape = sel && sel.type === "shape" && Model.findShape(this.data, sel.id);
	if (!shape || !this.isEditable()) {
		return null;
	}
	var handle = handleEl.getAttribute("data-pb-handle");
	var original = JSON.parse(JSON.stringify(shape));
	var box = Model.isBoxType(shape.type);
	var from = box ? {x: original.x, y: original.y, w: original.w, h: original.h} : Model.shapeBounds(original);
	var rot = box ? (original.rot || 0) : 0;
	var center = {x: from.x + from.w / 2, y: from.y + from.h / 2};
	return {
		kind: "handle",
		start: start,
		capture: true,
		onStart: function() { this.checkpoint(); },
		onMove: function(g, world, event) {
			copyGeometry(shape, original);
			if (handle === "rot") {
				var a0 = Math.atan2(start.world.y - center.y, start.world.x - center.x);
				var a1 = Math.atan2(world.y - center.y, world.x - center.x);
				var angle = rot + (a1 - a0) * 180 / Math.PI;
				if (event.shiftKey) {
					angle = Math.round(angle / 15) * 15;
				} else if (Math.abs(Model.normalizeAngle(angle)) < 3) {
					angle = 0;
				}
				angle = Model.normalizeAngle(angle);
				if (angle) {
					shape.rot = angle;
				} else {
					delete shape.rot;
				}
			} else if (handle === "p0" || handle === "p1") {
				var i = handle === "p0" ? 0 : shape.points.length - 1;
				shape.points[i] = [Model.round(original.points[i][0] + world.x - start.world.x), Model.round(original.points[i][1] + world.y - start.world.y)];
			} else {
				// Work in the shape's own (unrotated) frame.
				var d = rotatePoint(world.x - start.world.x, world.y - start.world.y, -rot);
				var to = {x: from.x, y: from.y, w: from.w, h: from.h};
				if (handle.indexOf("w") >= 0) { to.x += d.x; to.w -= d.x; }
				if (handle.indexOf("e") >= 0) { to.w += d.x; }
				if (handle.indexOf("n") >= 0) { to.y += d.y; to.h -= d.y; }
				if (handle.indexOf("s") >= 0) { to.h += d.y; }
				if (event.shiftKey && from.w > 0 && from.h > 0) {
					// Keep proportions.
					var ratio = from.w / from.h;
					var w = Math.max(Math.abs(to.w), Math.abs(to.h) * ratio);
					var nw = w * (to.w < 0 ? -1 : 1), nh = (w / ratio) * (to.h < 0 ? -1 : 1);
					if (handle.indexOf("w") >= 0) { to.x = from.x + from.w - nw; }
					if (handle.indexOf("n") >= 0) { to.y = from.y + from.h - nh; }
					to.w = nw; to.h = nh;
				}
				if (rot) {
					// Keep the opposite corner where it is on the board.
					to = Model.normalizeRect(to);
					var ax = handle.indexOf("w") >= 0 ? 1 : 0, ay = handle.indexOf("n") >= 0 ? 1 : 0;
					var before = cornerOnBoard(from, ax, ay, rot), after = cornerOnBoard(to, ax, ay, rot);
					to.x += before.x - after.x;
					to.y += before.y - after.y;
				}
				Model.resizeShape(shape, from, to);
			}
			this.updateShapeEl(shape);
			this.renderSelection();
		},
		onEnd: function() { this.commit(); },
		onCancel: function() {
			copyGeometry(shape, original);
			if (original.rot) {
				shape.rot = original.rot;
			} else {
				delete shape.rot;
			}
			this.renderShapes();
		}
	};
};

function rotatePoint(x, y, deg) {
	var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
	return {x: x * c - y * s, y: x * s + y * c};
}

/*
Board position of a corner (ax, ay in 0/1) of a rectangle rotated by
`rot` around its center.
*/
function cornerOnBoard(rect, ax, ay, rot) {
	var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
	var p = rotatePoint(rect.x + ax * rect.w - cx, rect.y + ay * rect.h - cy, rot);
	return {x: cx + p.x, y: cy + p.y};
}

methods.startEraseGesture = function(start) {
	var erased = false;
	var eraseAt = function(clientX, clientY) {
		var hit = this.document.elementFromPoint(clientX, clientY);
		var el = Dom.closest(hit, "[data-pb-shape]", this.viewport);
		if (el) {
			if (!erased) {
				erased = true;
				this.checkpoint();
			}
			Model.removeShape(this.data, el.getAttribute("data-pb-shape"));
			Dom.remove(el);
		}
	};
	eraseAt.call(this, start.clientX, start.clientY);
	return {
		kind: "erase",
		start: start,
		capture: true,
		alwaysEnd: true,
		onMove: function(g, world, event) {
			eraseAt.call(this, event.clientX, event.clientY);
		},
		onEnd: function() {
			if (erased) {
				this.commit();
			}
		}
	};
};

/*** Styling the selection ***/

methods.selectedShape = function() {
	var sel = this.selection;
	return (sel && sel.type === "shape") ? Model.findShape(this.data, sel.id) : null;
};

methods.applyStyle = function(key, value) {
	this.style[key] = value;
	var shape = this.selectedShape();
	if (shape && this.isEditable()) {
		this.checkpoint();
		if (key === "width" && shape.type === "highlighter") {
			value = value * 5;
		}
		if (key === "fill" && (shape.type === "pen" || shape.type === "highlighter" || shape.type === "line" || shape.type === "arrow" || shape.type === "frame")) {
			// Strokes have no fill.
		} else {
			shape[key] = value;
		}
		this.commit();
	} else {
		this.updateUi();
	}
};

methods.setShapeLayer = function(layer) {
	var shape = this.selectedShape();
	if (shape) {
		this.checkpoint();
		shape.layer = layer;
		// Also move it to the top of its layer.
		this.data.shapes = this.data.shapes.filter(function(s) { return s !== shape; });
		if (layer === "back") {
			this.data.shapes.unshift(shape);
		} else {
			this.data.shapes.push(shape);
		}
		this.commit();
	}
};
