/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/model.js
type: application/javascript
module-type: library

Pure data and geometry helpers for the Pinboard engine. Nothing in here
touches the DOM, so it is safe to load (and test) under Node.js.

The pinboard document is stored as JSON in a field of the store tiddler:

{
  "version": 1,
  "cards":  { "<tiddler>": { "x", "y", "w", "h", "fields" } },
  "shapes": [ { "id", "type", "x", "y", "w", "h", "points", "stroke",
                "fill", "width", "text", "layer", "fontSize" } ],
  "steps":  [ { "id", "kind", "ref", "x", "y", "w", "h" } ],
  "view":   { "x", "y", "scale" }
}

\*/

"use strict";

var BOX_TYPES = {rect: true, ellipse: true, text: true, sticky: true, frame: true};
var POINT_TYPES = {pen: true, highlighter: true, line: true, arrow: true};
var STEP_KINDS = {frame: true, card: true, shape: true, view: true};

exports.SHAPE_TYPES = Object.keys(BOX_TYPES).concat(Object.keys(POINT_TYPES));

exports.isBoxType = function(type) { return !!BOX_TYPES[type]; };
exports.isPointType = function(type) { return !!POINT_TYPES[type]; };
exports.hasText = function(type) {
	return type === "text" || type === "sticky" || type === "rect" || type === "ellipse" || type === "frame";
};

function num(value, fallback) {
	value = Number(value);
	return isFinite(value) ? value : fallback;
}

function round(n) {
	return Math.round(n * 10) / 10;
}
exports.round = round;

function str(value) {
	return (typeof value === "string") ? value : undefined;
}

/*** Document ***/

exports.emptyDoc = function() {
	return {version: 1, cards: Object.create(null), shapes: [], steps: []};
};

exports.parseDoc = function(text) {
	var doc = null;
	if (text) {
		try {
			doc = JSON.parse(text);
		} catch (e) {
			doc = null;
		}
	}
	return exports.normalizeDoc(doc);
};

exports.serializeDoc = function(doc) {
	var out = {version: 1, cards: {}, shapes: doc.shapes, steps: doc.steps};
	var ids = Object.keys(doc.cards).sort();
	for (var i = 0; i < ids.length; i++) {
		var card = doc.cards[ids[i]];
		if (card && Object.keys(card).length > 0) {
			out.cards[ids[i]] = card;
		}
	}
	if (doc.view) {
		out.view = doc.view;
	}
	return JSON.stringify(out);
};

exports.cloneDoc = function(doc) {
	return exports.parseDoc(exports.serializeDoc(doc));
};

exports.normalizeDoc = function(doc) {
	var out = exports.emptyDoc();
	if (!doc || typeof doc !== "object") {
		return out;
	}
	if (doc.cards && typeof doc.cards === "object" && !Array.isArray(doc.cards)) {
		for (var id in doc.cards) {
			var card = normalizeCard(doc.cards[id]);
			if (card) {
				out.cards[id] = card;
			}
		}
	}
	if (Array.isArray(doc.shapes)) {
		var seen = Object.create(null);
		for (var i = 0; i < doc.shapes.length; i++) {
			var shape = exports.normalizeShape(doc.shapes[i]);
			if (shape && !seen[shape.id]) {
				seen[shape.id] = true;
				out.shapes.push(shape);
			}
		}
	}
	if (Array.isArray(doc.steps)) {
		for (var i = 0; i < doc.steps.length; i++) {
			var step = normalizeStep(doc.steps[i]);
			if (step) {
				out.steps.push(step);
			}
		}
	}
	if (doc.view && typeof doc.view === "object") {
		var scale = num(doc.view.scale, 0);
		if (scale > 0) {
			out.view = {x: num(doc.view.x, 0), y: num(doc.view.y, 0), scale: scale};
		}
	}
	return out;
};

function normalizeCard(card) {
	if (!card || typeof card !== "object") {
		return null;
	}
	var out = {};
	["x", "y", "w", "h"].forEach(function(key) {
		var value = num(card[key], undefined);
		if (value !== undefined) {
			out[key] = value;
		}
	});
	if (typeof card.fields === "string") {
		out.fields = card.fields;
	}
	return out;
}

exports.normalizeShape = function(shape) {
	if (!shape || typeof shape !== "object" || typeof shape.id !== "string") {
		return null;
	}
	var type = shape.type;
	var out = {id: shape.id, type: type};
	if (BOX_TYPES[type]) {
		var rect = exports.normalizeRect({
			x: num(shape.x, 0), y: num(shape.y, 0),
			w: num(shape.w, 0), h: num(shape.h, 0)});
		out.x = rect.x; out.y = rect.y; out.w = rect.w; out.h = rect.h;
	} else if (POINT_TYPES[type]) {
		if (!Array.isArray(shape.points)) {
			return null;
		}
		out.points = [];
		for (var i = 0; i < shape.points.length; i++) {
			var p = shape.points[i];
			if (Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) {
				out.points.push([Number(p[0]), Number(p[1])]);
			}
		}
		if (out.points.length < 2) {
			return null;
		}
	} else {
		return null;
	}
	out.stroke = str(shape.stroke) || "#1f2937";
	out.fill = str(shape.fill) || "none";
	out.width = Math.max(0, num(shape.width, 2));
	out.layer = (shape.layer === "back") ? "back" : "front";
	if (typeof shape.text === "string" && shape.text) {
		out.text = shape.text;
	}
	var fontSize = num(shape.fontSize, 0);
	if (fontSize > 0) {
		out.fontSize = fontSize;
	}
	return out;
};

function normalizeStep(step) {
	if (!step || typeof step !== "object" || !STEP_KINDS[step.kind]) {
		return null;
	}
	var out = {id: str(step.id) || exports.newId("t"), kind: step.kind};
	if (step.kind === "view") {
		var rect = exports.normalizeRect({
			x: num(step.x, 0), y: num(step.y, 0),
			w: num(step.w, 0), h: num(step.h, 0)});
		if (rect.w <= 0 || rect.h <= 0) {
			return null;
		}
		out.x = rect.x; out.y = rect.y; out.w = rect.w; out.h = rect.h;
	} else if (typeof step.ref === "string" && step.ref) {
		out.ref = step.ref;
	} else {
		return null;
	}
	if (typeof step.title === "string" && step.title) {
		out.title = step.title;
	}
	return out;
}

var idCounter = 0;
exports.newId = function(prefix) {
	idCounter = (idCounter + 1) % 1296;
	return (prefix || "s") + Date.now().toString(36) + idCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
};

exports.findShape = function(doc, id) {
	for (var i = 0; i < doc.shapes.length; i++) {
		if (doc.shapes[i].id === id) {
			return doc.shapes[i];
		}
	}
	return null;
};

exports.removeShape = function(doc, id) {
	doc.shapes = doc.shapes.filter(function(s) { return s.id !== id; });
	doc.steps = doc.steps.filter(function(s) {
		return !((s.kind === "frame" || s.kind === "shape") && s.ref === id);
	});
};

/*** Fields ***/

exports.DEFAULT_FIELDS = "title text";

/*
Returns the list of fields a card should show. The first non-empty source
wins: the per-board choice made in the field chooser, the node's "fields"
property, then the graph's "fields" property.
*/
exports.resolveFields = function(cardChoice, nodeFields, graphFields) {
	var source;
	if (typeof cardChoice === "string") {
		source = cardChoice;
	} else if (nodeFields) {
		source = nodeFields;
	} else if (graphFields) {
		source = graphFields;
	} else {
		source = exports.DEFAULT_FIELDS;
	}
	return $tw.utils.parseStringArray(source) || [];
};

/*
Orders the fields offered in the field chooser: chosen ones first in their
chosen order, then everything else alphabetically.
*/
exports.chooserFields = function(available, chosen) {
	var seen = Object.create(null);
	var out = [];
	chosen.forEach(function(f) {
		if (!seen[f]) {
			seen[f] = true;
			out.push(f);
		}
	});
	available.slice().sort().forEach(function(f) {
		if (!seen[f] && f.indexOf("draft.") !== 0) {
			seen[f] = true;
			out.push(f);
		}
	});
	return out;
};

/*** Geometry ***/

exports.normalizeRect = function(rect) {
	var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
	if (w < 0) { x += w; w = -w; }
	if (h < 0) { y += h; h = -h; }
	return {x: x, y: y, w: w, h: h};
};

exports.unionRects = function(rects) {
	var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (var i = 0; i < rects.length; i++) {
		var r = rects[i];
		if (!r) {
			continue;
		}
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.w);
		maxY = Math.max(maxY, r.y + r.h);
	}
	if (minX === Infinity) {
		return null;
	}
	return {x: minX, y: minY, w: maxX - minX, h: maxY - minY};
};

exports.shapeBounds = function(shape) {
	if (BOX_TYPES[shape.type]) {
		return {x: shape.x, y: shape.y, w: shape.w, h: shape.h};
	}
	var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (var i = 0; i < shape.points.length; i++) {
		var p = shape.points[i];
		minX = Math.min(minX, p[0]);
		minY = Math.min(minY, p[1]);
		maxX = Math.max(maxX, p[0]);
		maxY = Math.max(maxY, p[1]);
	}
	var pad = (shape.width || 0) / 2;
	return {x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad};
};

exports.translateShape = function(shape, dx, dy) {
	if (BOX_TYPES[shape.type]) {
		shape.x = round(shape.x + dx);
		shape.y = round(shape.y + dy);
	} else {
		for (var i = 0; i < shape.points.length; i++) {
			shape.points[i] = [round(shape.points[i][0] + dx), round(shape.points[i][1] + dy)];
		}
	}
};

/*
Maps a shape from one bounding rectangle onto another (used for resizing).
*/
exports.resizeShape = function(shape, from, to) {
	to = exports.normalizeRect(to);
	if (BOX_TYPES[shape.type]) {
		shape.x = round(to.x); shape.y = round(to.y);
		shape.w = round(to.w); shape.h = round(to.h);
		return;
	}
	var sx = from.w ? to.w / from.w : 1;
	var sy = from.h ? to.h / from.h : 1;
	for (var i = 0; i < shape.points.length; i++) {
		var p = shape.points[i];
		shape.points[i] = [round(to.x + (p[0] - from.x) * sx), round(to.y + (p[1] - from.y) * sy)];
	}
};

/*
Drops points which are closer than `tolerance` to the previous kept point.
Keeps freehand strokes small without visibly changing them.
*/
exports.simplifyPoints = function(points, tolerance) {
	if (points.length <= 2) {
		return points.slice();
	}
	var t2 = tolerance * tolerance;
	var out = [points[0]];
	var last = points[0];
	for (var i = 1; i < points.length - 1; i++) {
		var dx = points[i][0] - last[0], dy = points[i][1] - last[1];
		if (dx * dx + dy * dy >= t2) {
			out.push(points[i]);
			last = points[i];
		}
	}
	out.push(points[points.length - 1]);
	return out;
};

/*
Smooth SVG path through the points, using midpoints as quadratic anchors.
*/
exports.smoothPath = function(points) {
	if (points.length === 0) {
		return "";
	}
	var d = "M" + points[0][0] + " " + points[0][1];
	if (points.length < 3) {
		for (var i = 1; i < points.length; i++) {
			d += "L" + points[i][0] + " " + points[i][1];
		}
		return d;
	}
	for (var i = 1; i < points.length - 1; i++) {
		var mx = round((points[i][0] + points[i + 1][0]) / 2);
		var my = round((points[i][1] + points[i + 1][1]) / 2);
		d += "Q" + points[i][0] + " " + points[i][1] + " " + mx + " " + my;
	}
	var last = points[points.length - 1];
	return d + "L" + last[0] + " " + last[1];
};

/*
Point where the segment from the center of `rect` towards (tx, ty) leaves
the rectangle. Used to end edges at card borders.
*/
exports.clipToRect = function(rect, tx, ty, margin) {
	margin = margin || 0;
	var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
	var dx = tx - cx, dy = ty - cy;
	if (dx === 0 && dy === 0) {
		return {x: cx, y: cy};
	}
	var hw = rect.w / 2 + margin, hh = rect.h / 2 + margin;
	var scale = Math.min(
		dx !== 0 ? hw / Math.abs(dx) : Infinity,
		dy !== 0 ? hh / Math.abs(dy) : Infinity);
	scale = Math.min(scale, 1);
	return {x: cx + dx * scale, y: cy + dy * scale};
};

/*** Camera ***/

/*
A camera is {x, y, s}: screen = world * s + (x, y).
*/
exports.fitRect = function(rect, viewW, viewH, padding, maxScale) {
	padding = padding === undefined ? 0.08 : padding;
	var w = Math.max(rect.w, 1), h = Math.max(rect.h, 1);
	var s = Math.min(viewW * (1 - 2 * padding) / w, viewH * (1 - 2 * padding) / h);
	if (maxScale) {
		s = Math.min(s, maxScale);
	}
	s = Math.max(s, 0.02);
	return {
		s: s,
		x: viewW / 2 - (rect.x + rect.w / 2) * s,
		y: viewH / 2 - (rect.y + rect.h / 2) * s
	};
};

exports.viewRect = function(camera, viewW, viewH) {
	return {
		x: -camera.x / camera.s,
		y: -camera.y / camera.s,
		w: viewW / camera.s,
		h: viewH / camera.s
	};
};

exports.zoomAt = function(camera, factor, sx, sy, minScale, maxScale) {
	var s = Math.min(maxScale || 8, Math.max(minScale || 0.05, camera.s * factor));
	var k = s / camera.s;
	return {s: s, x: sx - (sx - camera.x) * k, y: sy - (sy - camera.y) * k};
};

function cosh(x) { return ((x = Math.exp(x)) + 1 / x) / 2; }
function sinh(x) { return ((x = Math.exp(x)) - 1 / x) / 2; }
function tanh(x) { return ((x = Math.exp(2 * x)) - 1) / (x + 1); }

/*
Smooth zoom-and-pan between two cameras, after van Wijk & Nuij,
"Smooth and efficient zooming and panning" (2003). The camera zooms out
while travelling and in again on arrival, which is what gives presentations
their "flying over the board" feeling.

Returns a function t (0..1) -> camera, with a suggested `duration` in ms.
*/
exports.interpolateCamera = function(from, to, viewW, viewH, rho) {
	rho = rho || 1.4;
	var rho2 = rho * rho, rho4 = rho2 * rho2;
	// Convert to (center x, center y, visible width) in world units.
	var ux0 = (viewW / 2 - from.x) / from.s, uy0 = (viewH / 2 - from.y) / from.s, w0 = viewW / from.s;
	var ux1 = (viewW / 2 - to.x) / to.s, uy1 = (viewH / 2 - to.y) / to.s, w1 = viewW / to.s;
	var dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
	var S, at;
	if (d2 < 1e-12) {
		S = Math.log(w1 / w0) / rho;
		at = function(t) {
			return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
		};
	} else {
		var d1 = Math.sqrt(d2),
			b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1),
			b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1),
			r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0),
			r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
		S = (r1 - r0) / rho;
		at = function(t) {
			var s = t * S,
				coshr0 = cosh(r0),
				u = w0 / (rho2 * d1) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
			return [ux0 + u * dx, uy0 + u * dy, w0 * coshr0 / cosh(rho * s + r0)];
		};
	}
	var fn = function(t) {
		if (t >= 1) {
			return {x: to.x, y: to.y, s: to.s};
		}
		var p = at(t);
		var s = viewW / p[2];
		return {s: s, x: viewW / 2 - p[0] * s, y: viewH / 2 - p[1] * s};
	};
	var duration = Math.abs(S) * 1000 * rho / Math.SQRT2;
	fn.duration = isFinite(duration) ? Math.min(2400, Math.max(500, duration)) : 500;
	return fn;
};

/*** Colors ***/

/*
Picks black or white text for a given background color string.
*/
exports.contrastColor = function(color) {
	var rgb = parseColor(color);
	if (!rgb) {
		return "";
	}
	var lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
	return lum > 150 ? "#111" : "#fff";
};

function parseColor(color) {
	if (typeof color !== "string") {
		return null;
	}
	var m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
	if (m) {
		var hex = m[1];
		if (hex.length === 3 || hex.length === 4) {
			return [0, 1, 2].map(function(i) { return parseInt(hex[i] + hex[i], 16); });
		}
		if (hex.length >= 6) {
			return [0, 2, 4].map(function(i) { return parseInt(hex.substr(i, 2), 16); });
		}
		return null;
	}
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
	if (m) {
		return [Number(m[1]), Number(m[2]), Number(m[3])];
	}
	return null;
}
exports.parseColor = parseColor;
