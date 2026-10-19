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
  "steps":  [ { "id", "kind", "ref", "x", "y", "w", "h", "level" } ],
  "view":   { "x", "y", "scale" }
}

A board can hold several stories (presentation paths). Then "stories"
replaces "steps":

  "stories": [ { "id", "title", "color", "width", "tiddler", "steps" } ],
  "story":   "<id of the story shown>"

In memory `doc.steps` always is the steps of the shown story, so code that
only knows one path keeps working.

\*/

"use strict";

var BOX_TYPES = {rect: true, ellipse: true, text: true, sticky: true, frame: true};
var POINT_TYPES = {pen: true, highlighter: true, line: true, arrow: true, curve: true, polygon: true};
var STEP_KINDS = {frame: true, card: true, shape: true, view: true};
var TEXT_MODES = {full: true, "break": true, image: true, imagebreak: true};

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
	var doc = {version: 1, cards: Object.create(null), shapes: [], stories: [exports.newStory("main")], story: "main"};
	defineSteps(doc);
	return doc;
};

exports.DEFAULT_STORY_COLOR = "#e0503f";
exports.MAX_LEVEL = 5;

exports.newStory = function(id, title) {
	var story = {id: id || exports.newId("p"), steps: []};
	if (title) {
		story.title = title;
	}
	return story;
};

/*
`doc.steps` reads and writes the steps of the shown story.
*/
function defineSteps(doc) {
	Object.defineProperty(doc, "steps", {
		enumerable: false,
		configurable: true,
		get: function() {
			return exports.activeStory(doc).steps;
		},
		set: function(steps) {
			exports.activeStory(doc).steps = steps;
		}
	});
}

exports.activeStory = function(doc) {
	for (var i = 0; i < doc.stories.length; i++) {
		if (doc.stories[i].id === doc.story) {
			return doc.stories[i];
		}
	}
	if (!doc.stories.length) {
		doc.stories.push(exports.newStory("main"));
	}
	doc.story = doc.stories[0].id;
	return doc.stories[0];
};

exports.findStory = function(doc, id) {
	for (var i = 0; i < doc.stories.length; i++) {
		if (doc.stories[i].id === id) {
			return doc.stories[i];
		}
	}
	return null;
};

exports.storyTitle = function(doc, story) {
	return story.title || ("Story " + (doc.stories.indexOf(story) + 1));
};

exports.storyColor = function(story) {
	return story.color || exports.DEFAULT_STORY_COLOR;
};

/*
The tiddler a step stands for in its story's outline: a card's own tiddler,
or the chapter tiddler of a frame. Other steps have none.
*/
exports.stepTiddler = function(doc, step) {
	if (step.kind === "card") {
		return step.ref;
	}
	if (step.kind === "frame") {
		var shape = exports.findShape(doc, step.ref);
		return (shape && shape.tiddler) || null;
	}
	return null;
};

/*
The outline of a story, one entry per step: its tiddler (or null) and its
level. A card lying inside the frame that last opened a chapter sits one
level below it, on top of the indent given by hand. `centerOf(id)` tells
where a card is.
*/
exports.storyOutline = function(doc, story, centerOf) {
	var chapter = null;
	return story.steps.map(function(step) {
		var level = step.level || 0;
		if (step.kind === "frame") {
			chapter = exports.findShape(doc, step.ref);
		} else if (step.kind === "card" && chapter) {
			var c = centerOf && centerOf(step.ref);
			if (c && c.x >= chapter.x && c.x <= chapter.x + chapter.w && c.y >= chapter.y && c.y <= chapter.y + chapter.h) {
				level += 1;
			}
		}
		return {tiddler: exports.stepTiddler(doc, step), level: Math.min(level, exports.MAX_LEVEL)};
	});
};

/*
The tiddlers of a story in order, each once, with their levels.
*/
exports.storyTiddlers = function(doc, story, centerOf) {
	var seen = Object.create(null), out = [];
	exports.storyOutline(doc, story, centerOf).forEach(function(entry) {
		if (entry.tiddler && !seen[entry.tiddler]) {
			seen[entry.tiddler] = true;
			out.push(entry);
		}
	});
	return out;
};

exports.storyCards = function(doc, story) {
	return exports.storyTiddlers(doc, story).map(function(entry) { return entry.tiddler; });
};

/*
Reorders a story after its tiddler's list was changed elsewhere: card and
chapter steps follow the list, those that left the list leave the story,
new titles are appended as cards. Other steps keep their places. Returns
true if anything changed.
*/
exports.applyStoryList = function(doc, story, list) {
	var titleOf = function(step) { return exports.stepTiddler(doc, step); };
	var wanted = [], seen = Object.create(null);
	list.forEach(function(title) {
		if (title && !seen[title]) {
			seen[title] = true;
			wanted.push(title);
		}
	});
	if (wanted.join("\n") === exports.storyCards(doc, story).join("\n")) {
		return false;
	}
	var byRef = Object.create(null);
	story.steps.forEach(function(step) {
		var title = titleOf(step);
		if (title && !byRef[title]) {
			byRef[title] = step;
		}
	});
	var queue = wanted.map(function(title) {
		return byRef[title] || {id: exports.newId("t"), kind: "card", ref: title};
	});
	var out = [], used = Object.create(null);
	story.steps.forEach(function(step) {
		var title = titleOf(step);
		if (!title) {
			out.push(step);
		} else if (seen[title] && !used[title] && queue.length) {
			// One slot per title the story already had; duplicates drop out.
			used[title] = true;
			out.push(queue.shift());
		}
	});
	story.steps = out.concat(queue);
	return true;
};

/*
Indents (by +1) or outdents (by -1) a step. A step can be at most one level
deeper than the one before it.
*/
exports.indentStep = function(steps, index, by) {
	var step = steps[index];
	if (!step) {
		return false;
	}
	var before = index > 0 ? (steps[index - 1].level || 0) : -1;
	var level = Math.max(0, Math.min((step.level || 0) + by, before + 1, exports.MAX_LEVEL));
	if (level === (step.level || 0)) {
		return false;
	}
	if (level) {
		step.level = level;
	} else {
		delete step.level;
	}
	return true;
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
	var out = {version: 1, cards: {}, shapes: doc.shapes};
	var only = doc.stories.length === 1 ? doc.stories[0] : null;
	if (only && Object.keys(only).join(",") === "id,steps") {
		// One plain story is written the way boards always were.
		out.steps = only.steps;
	} else {
		out.stories = doc.stories;
		out.story = doc.story;
	}
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
	if (doc.background && Object.keys(doc.background).length) {
		out.background = doc.background;
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
	if (Array.isArray(doc.stories) && doc.stories.length) {
		out.stories = [];
		var storyIds = Object.create(null);
		doc.stories.forEach(function(raw) {
			var story = normalizeStory(raw);
			if (story && !storyIds[story.id]) {
				storyIds[story.id] = true;
				out.stories.push(story);
			}
		});
		if (!out.stories.length) {
			out.stories.push(exports.newStory("main"));
		}
		out.story = storyIds[doc.story] ? doc.story : out.stories[0].id;
	} else {
		out.stories[0].steps = normalizeSteps(doc.steps);
	}
	if (doc.background && typeof doc.background === "object") {
		var bg = {};
		["color", "pattern", "image"].forEach(function(key) {
			if (typeof doc.background[key] === "string" && doc.background[key]) {
				bg[key] = doc.background[key];
			}
		});
		if (bg.pattern && ["none", "dots", "grid", "lines"].indexOf(bg.pattern) < 0) {
			delete bg.pattern;
		}
		if (doc.background.imageMode === "board") {
			bg.imageMode = "board";
		}
		var imageScale = num(doc.background.imageScale, 0);
		if (imageScale > 0) {
			bg.imageScale = Math.min(1000, imageScale);
		}
		if (Object.keys(bg).length) {
			out.background = bg;
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

/*
"build" and "exit" name the presentation step at which an object appears
or disappears.
*/
function copyEffects(from, to) {
	if (typeof from.build === "string" && from.build) {
		to.build = from.build;
	}
	if (typeof from.exit === "string" && from.exit) {
		to.exit = from.exit;
	}
}

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
	["textMode", "presentMode"].forEach(function(key) {
		if (TEXT_MODES[card[key]]) {
			out[key] = card[key];
		}
	});
	copyEffects(card, out);
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
	if (BOX_TYPES[type]) {
		var rot = exports.normalizeAngle(num(shape.rot, 0));
		if (rot) {
			out.rot = rot;
		}
	}
	if (shape.hidden === true) {
		out.hidden = true;
	}
	if (type === "frame" && typeof shape.tiddler === "string" && shape.tiddler) {
		out.tiddler = shape.tiddler;
	}
	copyEffects(shape, out);
	return out;
};

/*
An SVG path through the points, smoothed into a Catmull-Rom curve.
*/
exports.threadPath = function(points) {
	if (points.length < 2) {
		return "";
	}
	var d = "M" + round(points[0].x) + " " + round(points[0].y);
	for (var i = 0; i < points.length - 1; i++) {
		var p0 = points[i > 0 ? i - 1 : i], p1 = points[i], p2 = points[i + 1];
		var p3 = points[i + 2 < points.length ? i + 2 : i + 1];
		var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
		var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
		d += "C" + round(c1x) + " " + round(c1y) + " " + round(c2x) + " " + round(c2y) + " " + round(p2.x) + " " + round(p2.y);
	}
	return d;
};

function normalizeSteps(list) {
	var out = [];
	if (Array.isArray(list)) {
		for (var i = 0; i < list.length; i++) {
			var step = normalizeStep(list[i]);
			if (step) {
				out.push(step);
			}
		}
	}
	return out;
}

function normalizeStory(story) {
	if (!story || typeof story !== "object") {
		return null;
	}
	var out = {id: str(story.id) || exports.newId("p")};
	["title", "tiddler"].forEach(function(key) {
		if (typeof story[key] === "string" && story[key]) {
			out[key] = story[key];
		}
	});
	if (typeof story.color === "string" && exports.parseColor(story.color)) {
		out.color = story.color;
	}
	var width = num(story.width, 0);
	if (width > 0) {
		out.width = Math.min(20, width);
	}
	out.steps = normalizeSteps(story.steps);
	return out;
}

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
	var level = Math.floor(num(step.level, 0));
	if (level > 0) {
		out.level = Math.min(exports.MAX_LEVEL, level);
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
	doc.stories.forEach(function(story) {
		story.steps = story.steps.filter(function(s) {
			return !((s.kind === "frame" || s.kind === "shape") && s.ref === id);
		});
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

exports.normalizeAngle = function(deg) {
	deg = ((deg % 360) + 540) % 360 - 180;
	return Math.round(deg * 10) / 10 || 0;
};

/*
Axis-aligned bounds. Box shapes may be rotated around their center.
*/
exports.shapeBounds = function(shape) {
	if (BOX_TYPES[shape.type]) {
		if (!shape.rot) {
			return {x: shape.x, y: shape.y, w: shape.w, h: shape.h};
		}
		var cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
		var a = shape.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
		var w = shape.w * c + shape.h * sn, h = shape.w * sn + shape.h * c;
		return {x: cx - w / 2, y: cy - h / 2, w: w, h: h};
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
Smooth curve through every point (Catmull-Rom turned into cubic Bezier
segments), optionally closed. Used by the Bezier and polygon tools.
*/
exports.curvePath = function(points, closed) {
	var n = points.length;
	if (n < 3) {
		return exports.smoothPath(points) + (closed ? "Z" : "");
	}
	var at = function(i) {
		if (closed) {
			return points[(i + n) % n];
		}
		return points[Math.max(0, Math.min(n - 1, i))];
	};
	var d = "M" + points[0][0] + " " + points[0][1];
	var last = closed ? n : n - 1;
	for (var i = 0; i < last; i++) {
		var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
		d += "C" + round(p1[0] + (p2[0] - p0[0]) / 6) + " " + round(p1[1] + (p2[1] - p0[1]) / 6) +
			" " + round(p2[0] - (p3[0] - p1[0]) / 6) + " " + round(p2[1] - (p3[1] - p1[1]) / 6) +
			" " + p2[0] + " " + p2[1];
	}
	return d + (closed ? "Z" : "");
};

exports.polygonPath = function(points) {
	return points.map(function(p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join("") + "Z";
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

/*** Camera (see camera.js) ***/

var Camera = require("./camera.js");
exports.fitRect = Camera.fitRect;
exports.viewRect = Camera.viewRect;
exports.zoomAt = Camera.zoomAt;
exports.interpolateCamera = Camera.interpolate;

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
